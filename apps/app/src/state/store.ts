/**
 * Estado de la aplicación (Zustand).
 *
 * Regla: el motor es la única fuente de verdad de los datos; este almacén solo
 * guarda *lo que se está mirando*. Después de cada ciclo se llama a
 * `syncFromEngine()` y la interfaz se repinta con lo que haya.
 *
 * La sesión se persiste aparte del motor (tema, idioma, filtros, leídos,
 * guardados) para que cerrar la app no cueste ni una preferencia.
 */
import { create } from 'zustand'

import {
  LatidoEngine,
  MemoryStore,
  createSessionState,
  defaultSourceConfigs,
  type AlertEvent,
  type AlertRule,
  type Entity,
  type Item,
  type ItemQuery,
  type SessionState,
  type SourceConfig,
  type SourceKind,
  type StoreSnapshot,
  type Trend,
} from '@latido/engine'

import { translate, type Language, type MessageKey } from '@/i18n'
import { archiveSync, clearState, ensureWideWindow, isDesktop, loadState, notify, platformFetch, readSecret, saveState, storeSecret } from '@/platform/bridge'
import { keywordsFrom, startRealtime, stopRealtime, type RealtimeStatus } from '@/state/realtime'
import {
  TranslationQueue,
  createTranslator,
  type TranslateProviderKind,
  type Translator,
} from '@latido/engine'

export type ViewKey =
  | 'home'
  | 'breaking'
  | 'radar'
  | 'following'
  | 'explore'
  | 'search'
  | 'bookmarks'
  | 'alerts'
  | 'lists'
  | 'sources'
  | 'settings'
  | 'item'

export type ThemeChoice = 'system' | 'dark' | 'light'
/**
 * Tema de plataforma: los tres temas oficiales. No cambian la marca, cambian las
 * maneras (radios, densidad, tipografía, elevación) para que la app se sienta
 * nativa en cada sistema.
 */
export type PlatformChoice = 'windows' | 'macos' | 'linux'

/**
 * Escala de la interfaz: `auto` la deduce del sistema; un número la fija.
 *
 * Windows con escalado al 125-150 % deja la ventana con muy pocos píxeles
 * lógicos, y sin corregirlo la aplicación parece ampliada: textos enormes y el
 * contexto lateral fuera de sitio. `auto` mide y compensa.
 */
export type UiScaleChoice = 'auto' | number

/** Sistema anfitrión, para acertar con el tema la primera vez. */
function detectPlatform(): PlatformChoice {
  const ua = (navigator.userAgent || '').toLowerCase()
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos'
  if (ua.includes('windows')) return 'windows'
  return 'linux'
}

export interface Filters {
  topics: string[]
  sources: SourceKind[]
  onlyWatched: boolean
  sort: 'recent' | 'engaged'
}

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'ok' | 'warn'
}

/**
 * Traducción del contenido.
 *
 * La app traduce **a lo que el usuario está leyendo**: el idioma destino es
 * siempre el de la interfaz. El texto original nunca se pierde ni se sustituye
 * en el archivo: la traducción es una capa encima, se puede ver el original con
 * un clic, y la clave del proveedor vive en el llavero del sistema, no en el
 * archivo de estado.
 */
export interface TranslationSettings {
  enabled: boolean
  kind: TranslateProviderKind
  /** URL base para LibreTranslate o para un servidor compatible con OpenAI. */
  endpoint: string
  model: string
}

/** Nombre del secreto en el llavero del sistema. */
const TRANSLATE_SECRET = 'translate.apiKey'

let translator: Translator | null = null
let translateQueue: TranslationQueue | null = null
let translateApiKey = ''
/** Cache en memoria: clave = texto original → texto traducido. */
let translateCache = new Map<string, string>()
let translateBuffer: Record<string, string> = {}
let translateFlush: ReturnType<typeof setTimeout> | null = null

/** Clave de búsqueda de una traducción: idioma destino + texto original. */
export function translationLookup(lang: string, text: string): string {
  return `${lang}\u0000${text}`
}

/** Rehace traductor y cola con la configuración vigente. */
function buildTranslator(settings: TranslationSettings, target: Language): void {
  translator = createTranslator(
    {
      kind: settings.kind,
      target,
      ...(settings.endpoint.trim() ? { endpoint: settings.endpoint.trim() } : {}),
      ...(translateApiKey ? { apiKey: translateApiKey } : {}),
      ...(settings.model.trim() ? { model: settings.model.trim() } : {}),
    },
    { fetch: globalThis.fetch, now: () => Date.now() },
  )
  translateQueue = null
}

function ensureQueue(target: Language): TranslationQueue | null {
  if (!translator?.available) return null
  if (translateQueue) return translateQueue
  translateQueue = new TranslationQueue({
    translator,
    cache: translateCache,
    target,
    onResult: ({ source, target, text }) => {
      translateBuffer[translationLookup(target, source)] = text
      // Se agrupan los resultados antes de tocar el estado: traducir cuarenta
      // titulares no debe provocar cuarenta repintados.
      if (translateFlush) return
      translateFlush = setTimeout(() => {
        translateFlush = null
        const patch = translateBuffer
        translateBuffer = {}
        const current = useLatido.getState()
        useLatido.setState((state) => ({ translations: { ...state.translations, ...patch } }))
        void current
      }, 250)
    },
    onError: (error) => {
      useLatido.setState({ translationError: error.message })
    },
  })
  return translateQueue
}

/** Encola los textos de lo que se está viendo, sin bloquear nada. */
function requestTranslations(items: Item[]): void {
  const state = useLatido.getState()
  if (!state.translation.enabled) return
  const queue = ensureQueue(state.lang)
  if (!queue) return
  const texts: string[] = []
  items.slice(0, 40).forEach((item, index) => {
    if (item.title) texts.push(item.title)
    // Los cuerpos son largos: solo los de lo primero que se ve.
    if (item.body && index < 12) texts.push(item.body)
  })
  queue.enqueue(texts)
  void queue.flush()
}

interface PersistedShape {
  version: number
  session: SessionState
  theme: ThemeChoice
  platform: PlatformChoice
  translation: TranslationSettings
  uiScale: UiScaleChoice
  lang: Language
  retentionDays: number
  interests: string[]
  onboarded: boolean
  sourceConfigs: SourceConfig[]
  rules: AlertRule[]
  snapshot: StoreSnapshot | null
}

const PERSIST_VERSION = 1

/** El motor vive fuera del almacén: no es serializable y no debe re-renderizar. */
let engine: LatidoEngine | null = null

export function getEngine(): LatidoEngine {
  if (!engine) {
    engine = new LatidoEngine({
      store: new MemoryStore(),
      log: (message) => {
        if (import.meta.env.DEV) console.info(`[latido] ${message}`)
      },
    })
  }
  return engine
}

interface LatidoState {
  ready: boolean
  polling: boolean
  /** `true` solo si se han cargado datos de ejemplo a mano (ajustes de desarrollo). */
  demoMode: boolean
  lastPollAt: number | null
  /** Estado del flujo en directo (Jetstream). La app no finge: si no hay flujo, se dice. */
  realtime: RealtimeStatus
  realtimeDetail: string | null
  /** Último error de sondeo, para que Fuentes y la cabecera puedan explicarlo. */
  pollError: string | null
  /** Traducciones disponibles, por texto original. */
  translations: Record<string, string>
  translation: TranslationSettings
  translationError: string | null
  /** `true` = se pide al usuario que traduzca: la capa está apagada o sin proveedor. */
  translationReady: boolean
  /** Entradas que el usuario prefiere leer en su idioma original. */
  showOriginal: Record<string, boolean>
  view: ViewKey
  theme: ThemeChoice
  platform: PlatformChoice
  uiScale: UiScaleChoice
  lang: Language
  filters: Filters
  query: string
  selectedTrendId: string | null
  selectedItemId: string | null
  paletteOpen: boolean
  interests: string[]
  onboarded: boolean
  retentionDays: number
  trends: Trend[]
  items: Item[]
  alerts: AlertEvent[]
  rules: AlertRule[]
  entities: Entity[]
  sources: SourceConfig[]
  bookmarkedIds: string[]
  counts: { items: number; trends: number; alerts: number; clusters: number }
  toasts: Toast[]

  init: () => Promise<void>
  poll: (kinds?: SourceKind[]) => Promise<void>
  sync: () => void
  startStream: () => void
  stopStream: () => void
  setView: (view: ViewKey) => void
  setTheme: (theme: ThemeChoice) => void
  setPlatform: (platform: PlatformChoice) => void
  setUiScale: (scale: UiScaleChoice) => void
  setTranslation: (patch: Partial<TranslationSettings>) => void
  setTranslationKey: (value: string) => Promise<void>
  testTranslation: () => Promise<void>
  clearTranslations: () => void
  toggleOriginal: (itemId: string) => void
  setLang: (lang: Language) => void
  setQuery: (query: string) => void
  setFilters: (filters: Partial<Filters>) => void
  toggleTopic: (topic: string) => void
  toggleSourceFilter: (source: SourceKind) => void
  selectTrend: (trendId: string | null) => void
  selectItem: (itemId: string | null) => void
  openPalette: (open: boolean) => void
  toggleBookmark: (itemId: string) => void
  markRead: (itemIds: string[]) => void
  markAllRead: () => void
  watchEntity: (slug: string, watch?: boolean) => void
  toggleSource: (kind: SourceKind, enabled?: boolean) => void
  updateSourceOptions: (kind: SourceKind, options: Record<string, string | number | boolean | string[]>) => void
  addRule: (rule: Omit<AlertRule, 'createdAt'>) => void
  toggleRule: (ruleId: string) => void
  removeRule: (ruleId: string) => void
  setRetention: (days: number) => void
  completeOnboarding: (interests: string[]) => void
  loadSample: () => void
  exportState: () => string
  importState: (json: string) => Promise<boolean>
  wipe: () => Promise<void>
  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
  t: (key: MessageKey, params?: Record<string, string | number>) => string
}

const defaultFilters: Filters = { topics: [], sources: [], onlyWatched: false, sort: 'recent' }

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useLatido = create<LatidoState>((set, get) => ({
  ready: false,
  polling: false,
  demoMode: false,
  lastPollAt: null,
  realtime: 'off',
  realtimeDetail: null,
  pollError: null,
  translations: {},
  translation: { enabled: false, kind: 'none', endpoint: '', model: '' },
  translationError: null,
  translationReady: false,
  showOriginal: {},
  view: 'home',
  uiScale: 'auto',
  theme: 'system',
  platform: detectPlatform(),
  lang: 'es',
  filters: defaultFilters,
  query: '',
  selectedTrendId: null,
  selectedItemId: null,
  paletteOpen: false,
  interests: [],
  onboarded: false,
  retentionDays: 30,
  trends: [],
  items: [],
  alerts: [],
  rules: [],
  entities: [],
  sources: defaultSourceConfigs(),
  bookmarkedIds: [],
  counts: { items: 0, trends: 0, alerts: 0, clusters: 0 },
  toasts: [],

  t: (key, params) => translate(get().lang, key, params),

  /** Arranque: hidrata, aplica preferencias y lanza el primer ciclo. */
  init: async () => {
    const saved = await loadState()
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as PersistedShape
        applyPersisted(parsed)
        if (parsed.snapshot) getEngine().hydrate(parsed.snapshot)
        if (parsed.rules) getEngine().store.putAlertRules(parsed.rules)
      } catch {
        // Un estado corrupto no debe impedir abrir la app: se empieza limpio.
      }
    }

    applyTheme(get().theme)
    applyPlatform(get().platform)
    applyScale(get().uiScale)
    applyLanguage(get().lang)

    // En el escritorio, si la ventana viene estrecha se maximiza: así se ve el
    // contexto lateral en lugar del modo compacto con todo ampliado.
    if (await ensureWideWindow()) applyScale(get().uiScale)

    // La clave del proveedor de traducción vive en el llavero del sistema.
    translateApiKey = (await readSecret(TRANSLATE_SECRET)) ?? ''
    buildTranslator(get().translation, get().lang)
    set({ translationReady: Boolean(translator?.available) })

    // El escritorio usa el cliente HTTP nativo: sin CORS, Reddit, Mastodon y
    // RSS dejan de estar bloqueados. En el navegador se queda el `fetch` normal.
    const bridgeFetch = await platformFetch()
    nativeFetch = bridgeFetch
    getEngine().setFetch(bridgeFetch)

    const current = get().sources
    const engineInstance = getEngine()
    for (const config of current) {
      const existing = engineInstance.sourceConfigs.get(config.kind)
      if (existing) Object.assign(existing, config)
      else engineInstance.sourceConfigs.set(config.kind, config)
    }
    engineInstance.seedEntities()
    engineInstance.onUpdate(() => get().sync())

    // Nada de contenido inventado: si no hay datos, se piden a las fuentes
    // reales. Si alguna no responde, la interfaz lo dice en vez de rellenar el
    // hueco con ejemplos.
    engineInstance.recompute()
    set({ ready: true })
    get().sync()

    void get().poll().then(() => get().startStream())
  },

  /**
   * Conecta el flujo en directo de Bluesky. Solo si hay términos que vigilar:
   * el flujo completo son miles de publicaciones por segundo y no aporta nada.
   */
  startStream: () => {
    const engineInstance = getEngine()
    const bluesky = engineInstance.sourceConfigs.get('bluesky')
    if (!bluesky?.enabled) {
      stopRealtime()
      set({ realtime: 'off', realtimeDetail: null })
      return
    }

    const keywords = keywordsFrom({
      queries: String(bluesky.options['queries'] ?? '').split(','),
      watchlist: [],
      entities: get().entities,
    })

    startRealtime({
      keywords,
      langs: ['es', 'en'],
      // El cliente nativo del escritorio: dentro del WebView, `fetch` está
      // limitado por el CSP y la resolución de nombres (DID → handle) fallaba,
      // así que las publicaciones salían como «did:plc:…» en lugar del nombre.
      fetchImpl: nativeFetch,
      onBatch: (raw) => {
        if (raw.length === 0) return
        engineInstance.ingest(raw)
        engineInstance.recompute()
        get().sync()
        scheduleSave(get)
      },
      onStatus: (status, detail) => set({ realtime: status, realtimeDetail: detail ?? null }),
    })
  },

  stopStream: () => {
    stopRealtime()
    set({ realtime: 'off', realtimeDetail: null })
  },

  /** Sondea todas las fuentes activas y avisa de lo que merezca la pena. */
  poll: async (kinds) => {
    if (get().polling) return
    set({ polling: true })
    try {
      const result = await getEngine().poll(kinds)
      const trends = getEngine().recompute()
      if (!get().demoMode) announceNewTrends(trends, get())
      const failed = result.errors.filter((error) => error.source !== 'demo')
      set({
        lastPollAt: Date.now(),
        pollError: failed.length > 0 ? failed[0]?.message ?? null : null,
      })
    } catch (error) {
      set({ pollError: (error as Error).message })
    } finally {
      set({ polling: false })
      get().sync()
      scheduleSave(get)
      scheduleArchive(get)
    }
  },

  /** Refresca lo que ve la interfaz desde el motor. */
  sync: () => {
    const engineInstance = getEngine()
    const { filters, query } = get()

    const items = engineInstance.feed(buildQuery(filters, query))
    const stats = engineInstance.stats()
    set({
      items,
      trends: engineInstance.radar({ limit: 60 }),
      alerts: engineInstance.store.allAlerts(120),
      rules: engineInstance.store.allAlertRules(),
      entities: engineInstance.store.allEntities(),
      sources: [...engineInstance.sourceConfigs.values()],
      bookmarkedIds: engineInstance.store.allBookmarks(),
      counts: {
        items: stats.items,
        trends: stats.trends,
        alerts: stats.alerts,
        clusters: stats.clusters,
      },
    })

    // La traducción va después de pintar: primero el dato real, luego la capa.
    requestTranslations(items)
  },

  setUiScale: (uiScale) => {
    applyScale(uiScale)
    set({ uiScale })
    scheduleSave(get)
  },

  setTranslation: (patch) => {
    const translation = { ...get().translation, ...patch }
    set({ translation, translationError: null })
    buildTranslator(translation, get().lang)
    set({ translationReady: Boolean(translator?.available) })
    if (translation.enabled) requestTranslations(get().items)
    scheduleSave(get)
  },

  setTranslationKey: async (value) => {
    translateApiKey = value.trim()
    const saved = await storeSecret(TRANSLATE_SECRET, translateApiKey)
    buildTranslator(get().translation, get().lang)
    set({ translationReady: Boolean(translator?.available) })
    if (!saved && translateApiKey) get().toast(get().t('settings.keyNotSaved'), 'warn')
    else get().toast(get().t('settings.saved'), 'ok')
  },

  testTranslation: async () => {
    buildTranslator(get().translation, get().lang)
    if (!translator?.available) {
      set({ translationError: get().t('translate.notConfigured') })
      get().toast(get().t('translate.notConfigured'), 'warn')
      return
    }
    try {
      const [sample] = await translator.translate([get().t('translate.sample')])
      set({ translationError: null })
      get().toast(sample ? `${get().t('translate.works')}: ${sample}` : get().t('translate.works'), 'ok')
    } catch (error) {
      set({ translationError: (error as Error).message })
      get().toast((error as Error).message, 'warn')
    }
  },

  clearTranslations: () => {
    translateCache = new Map()
    translateQueue = null
    set({ translations: {}, translationError: null })
    get().toast(get().t('translate.cacheCleared'), 'ok')
  },

  toggleOriginal: (itemId) => {
    const showOriginal = { ...get().showOriginal }
    if (showOriginal[itemId]) delete showOriginal[itemId]
    else showOriginal[itemId] = true
    set({ showOriginal })
  },

  setView: (view) => {
    set({ view })
    if (view !== 'search') set({ query: '' })
  },
  setPlatform: (platform) => {
    applyPlatform(platform)
    set({ platform })
    scheduleSave(get)
  },

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    scheduleSave(get)
  },
  setLang: (lang) => {
    applyLanguage(lang)
    set({ lang })
    // El idioma destino de la traducción es el de la interfaz: si cambia, el
    // traductor se rehace y se vuelve a pedir lo que se está viendo.
    buildTranslator(get().translation, lang)
    if (get().translation.enabled) requestTranslations(get().items)
    scheduleSave(get)
  },
  setQuery: (query) => {
    set({ query })
    if (query.trim().length > 0) set({ view: 'search' })
  },
  setFilters: (filters) => {
    set({ filters: { ...get().filters, ...filters } })
    get().sync()
    scheduleSave(get)
  },
  toggleTopic: (topic) => {
    const { topics } = get().filters
    const next = topics.includes(topic) ? topics.filter((entry) => entry !== topic) : [...topics, topic]
    get().setFilters({ topics: next })
  },
  toggleSourceFilter: (source) => {
    const { sources } = get().filters
    const next = sources.includes(source) ? sources.filter((entry) => entry !== source) : [...sources, source]
    get().setFilters({ sources: next })
  },
  selectTrend: (trendId) => {
    set({ selectedTrendId: trendId, view: trendId ? 'radar' : get().view })
  },
  selectItem: (itemId) => {
    set({ selectedItemId: itemId, view: itemId ? 'item' : 'home' })
    if (itemId) get().markRead([itemId])
  },
  openPalette: (open) => set({ paletteOpen: open }),

  toggleBookmark: (itemId) => {
    const store = getEngine().store
    if (store.isBookmarked(itemId)) store.removeBookmark(itemId)
    else store.addBookmark(itemId)
    get().sync()
    scheduleSave(get)
  },

  markRead: (itemIds) => {
    getEngine().store.markRead(itemIds)
    get().sync()
    scheduleSave(get)
  },
  markAllRead: () => {
    getEngine().store.markRead(get().items.map((item) => item.id))
    getEngine().store.markAlertsRead(get().alerts.map((event) => event.id))
    get().sync()
    scheduleSave(get)
  },

  watchEntity: (slug, watch) => {
    const entity = getEngine().store.getEntity(slug)
    if (!entity) return
    const next = watch ?? !entity.watch
    getEngine().store.putEntities([{ ...entity, watch: next }])
    if (next) {
      getEngine().addRule({
        id: `watch-${slug}`,
        kind: 'watched_entity',
        enabled: true,
        query: slug,
        minSources: 1,
        minGrowth: 0,
        cooldownMs: 3 * 60 * 60 * 1000,
      })
    }
    getEngine().recompute()
    get().sync()
    scheduleSave(get)
  },

  toggleSource: (kind, enabled) => {
    const config = getEngine().sourceConfigs.get(kind)
    if (!config) return
    config.enabled = enabled ?? !config.enabled
    get().sync()
    scheduleSave(get)
    if (config.enabled) void get().poll([kind])
    // El flujo en directo depende de que Bluesky esté encendida y tenga términos.
    if (kind === 'bluesky') get().startStream()
  },

  updateSourceOptions: (kind, options) => {
    const config = getEngine().sourceConfigs.get(kind)
    if (!config) return
    config.options = { ...config.options, ...options }
    get().sync()
    scheduleSave(get)
    void get().poll([kind])
    if (kind === 'bluesky') get().startStream()
  },

  addRule: (rule) => {
    getEngine().addRule(rule)
    getEngine().recompute()
    get().sync()
    scheduleSave(get)
  },
  toggleRule: (ruleId) => {
    getEngine().store.toggleAlertRule(ruleId)
    get().sync()
    scheduleSave(get)
  },
  removeRule: (ruleId) => {
    getEngine().store.removeAlertRule(ruleId)
    get().sync()
    scheduleSave(get)
  },
  setRetention: (days) => {
    set({ retentionDays: days })
    if (days > 0) getEngine().retain()
    get().sync()
    scheduleSave(get)
  },

  completeOnboarding: (interests) => {
    set({ interests, onboarded: true, view: 'home' })
    // Los intereses se traducen a búsquedas reales en Bluesky y a subreddits.
    const bluesky = getEngine().sourceConfigs.get('bluesky')
    if (bluesky && interests.length > 0) {
      bluesky.options['queries'] = interests.join(', ')
      bluesky.enabled = true
    }
    void get().poll()
    scheduleSave(get)
  },

  loadSample: () => {
    const engineInstance = getEngine()
    engineInstance.loadDemo()
    engineInstance.recompute()
    set({ demoMode: true })
    get().sync()
  },

  exportState: () => {
    const payload: PersistedShape = buildPersisted(get())
    return JSON.stringify(payload, null, 2)
  },

  importState: async (json) => {
    try {
      const parsed = JSON.parse(json) as PersistedShape
      applyPersisted(parsed)
      if (parsed.snapshot) getEngine().hydrate(parsed.snapshot)
      if (parsed.rules) getEngine().store.putAlertRules(parsed.rules)
      getEngine().recompute()
      applyTheme(get().theme)
      applyPlatform(get().platform)
      applyLanguage(get().lang)
      get().sync()
      await persist(get)
      return true
    } catch {
      return false
    }
  },

  wipe: async () => {
    engine = null
    await clearState()
    set({
      ready: false,
      demoMode: false,
      items: [],
      trends: [],
      alerts: [],
      counts: { items: 0, trends: 0, alerts: 0, clusters: 0 },
    })
    await get().init()
  },

  toast: (message, tone = 'info') => {
    const id = `toast-${Date.now()}-${Math.round(Math.random() * 1000)}`
    set({ toasts: [...get().toasts, { id, message, tone }] })
    setTimeout(() => get().dismissToast(id), 4200)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((entry) => entry.id !== id) }),
}))

// ── ayudas ──────────────────────────────────────────────────────────────────

function buildQuery(filters: Filters, query: string): ItemQuery {
  const base: ItemQuery = {
    limit: 80,
    order: filters.sort === 'engaged' ? 'engaged' : 'recent',
  }
  if (filters.topics.length > 0) base.topics = filters.topics
  if (filters.sources.length > 0) base.sources = filters.sources
  if (filters.onlyWatched) {
    base.entities = []
  }
  if (query.trim().length > 0) base.limit = 120
  return base
}

function applyPersisted(parsed: Partial<PersistedShape>): void {
  const state = useLatido.getState()
  if (parsed.theme) state.theme = parsed.theme
  if (parsed.platform) state.platform = parsed.platform
  if (parsed.uiScale !== undefined) state.uiScale = parsed.uiScale
  if (parsed.translation) state.translation = { ...state.translation, ...parsed.translation }
  if (parsed.lang) state.lang = parsed.lang
  if (parsed.retentionDays !== undefined) state.retentionDays = parsed.retentionDays
  if (parsed.interests) state.interests = parsed.interests
  if (parsed.onboarded !== undefined) state.onboarded = parsed.onboarded
  if (parsed.sourceConfigs) state.sources = parsed.sourceConfigs
  if (parsed.rules) state.rules = parsed.rules
  if (parsed.session) {
    state.filters = {
      ...state.filters,
      ...(parsed.session.filters ?? {}),
      sort: state.filters.sort,
    }
  }
  useLatido.setState({
    theme: state.theme,
    platform: state.platform,
    uiScale: state.uiScale,
    translation: state.translation,
    lang: state.lang,
    retentionDays: state.retentionDays,
    interests: state.interests,
    onboarded: state.onboarded,
    sources: state.sources,
    rules: state.rules,
    filters: state.filters,
  })
}

function buildPersisted(state: LatidoState): PersistedShape {
  const session: SessionState = {
    ...createSessionState(),
    filters: {
      topics: state.filters.topics,
      sources: state.filters.sources,
      onlyWatched: state.filters.onlyWatched,
      since: null,
    },
    theme: state.theme === 'system' ? 'system' : state.theme,
    lang: state.lang,
    lastOpenedAt: Date.now(),
  }
  return {
    version: PERSIST_VERSION,
    session,
    theme: state.theme,
    platform: state.platform,
    uiScale: state.uiScale,
    translation: state.translation,
    lang: state.lang,
    retentionDays: state.retentionDays,
    interests: state.interests,
    onboarded: state.onboarded,
    sourceConfigs: state.sources,
    rules: state.rules,
    snapshot: getEngine().snapshot(),
  }
}

async function persist(get: () => LatidoState): Promise<void> {
  const state = get()
  const payload = JSON.stringify(buildPersisted(state))
  const ok = await saveState(payload)
  if (!ok) state.toast(state.t('settings.saved'), 'warn')
}

/** Guarda como mucho una vez por segundo: sondear no debe escribir en disco. */
function scheduleSave(get: () => LatidoState): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void persist(get), 1000)
}

let archiveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Refleja el estado vivo en el archivo SQLite. Solo en escritorio, y con retraso:
 * el archivo es para durar, no para ir detrás de cada latido de la interfaz.
 */
function scheduleArchive(get: () => LatidoState): void {
  if (!isDesktop()) return
  if (archiveTimer) clearTimeout(archiveTimer)
  archiveTimer = setTimeout(() => {
    const state = get()
    const payload = {
      items: state.items.slice(0, 400).map((item) => ({
        id: item.id,
        source: item.source,
        url: item.url,
        title: item.title ?? null,
        body: item.body ?? null,
        lang: item.lang ?? null,
        author_handle: item.author.handle,
        author_name: item.author.displayName ?? null,
        published_at: item.publishedAt,
        ingested_at: item.ingestedAt,
        likes: item.metrics.likes ?? 0,
        replies: item.metrics.replies ?? 0,
        reposts: item.metrics.reposts ?? 0,
        comments: item.metrics.comments ?? 0,
        stars: item.metrics.stars ?? 0,
        tags: item.tags,
        entities: item.entities,
        cluster_id: item.clusterId ?? null,
        simhash: item.simhash,
      })),
      trends: state.trends.map((trend) => ({
        id: trend.id,
        title: trend.title,
        state: trend.state,
        score: trend.score,
        velocity: trend.velocity,
        growth: trend.growth,
        volume: trend.volume,
        coverage: trend.coverage,
        first_seen: trend.firstSeen,
        last_seen: trend.lastSeen,
        reason_code: trend.reason.code,
      })),
      pruning_days: state.retentionDays === 0 ? null : state.retentionDays,
    }
    void archiveSync(payload)
  }, 4000)
}

/** Cliente HTTP en uso: en el escritorio es el nativo (sin CORS ni CSP). */
let nativeFetch: typeof fetch = globalThis.fetch

/** Escala efectiva según lo que diga el sistema o la elección del usuario. */
function effectiveScale(choice: UiScaleChoice): number {
  if (typeof choice === 'number') return choice
  const dpr = window.devicePixelRatio || 1
  const width = window.innerWidth
  if (dpr >= 1.5) return 0.85
  if (dpr >= 1.25) return 0.9
  if (width < 1100) return 0.92
  if (width < 1280) return 0.96
  return 1
}

/** Aplica la escala de la interfaz moviendo la raíz tipográfica. */
function applyScale(choice: UiScaleChoice): void {
  document.documentElement.style.setProperty('--ui-scale', String(effectiveScale(choice)))
}

/** Aplica el tema de plataforma (radios, densidad, tipografía, neutros). */
function applyPlatform(platform: PlatformChoice): void {
  document.documentElement.dataset['platform'] = platform
}

function applyTheme(theme: ThemeChoice): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  const effective =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', effective === 'light' ? '#F6F2EA' : '#131110')
}

function applyLanguage(lang: Language): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
}

/** Un aviso del sistema por cada tema nuevo que de verdad lo merezca. */
function announceNewTrends(trends: Trend[], state: LatidoState): void {
  if (trends.length === 0) return
  const store = getEngine().store
  const worth = trends.filter(
    (trend) => (trend.state === 'breaking' || trend.state === 'emerging') && !trend.acknowledged,
  )
  for (const trend of worth.slice(0, 2)) {
    store.acknowledgeTrend(trend.id)
    void notify({
      title: state.t('radar.title') + ' · ' + state.t(`radar.${trend.state}` as MessageKey),
      body: trend.title,
      tag: trend.id,
    })
  }
}

// Atajos globales: Ctrl/Cmd+K abre comandos y el tema se cambia sin menús.
if (typeof window !== 'undefined' && isDesktop() === false) {
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      const state = useLatido.getState()
      state.openPalette(!state.paletteOpen)
    }
  })
}
