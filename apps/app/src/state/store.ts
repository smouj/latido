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
import { archiveSync, clearState, isDesktop, loadState, notify, platformFetch, saveState } from '@/platform/bridge'
import { keywordsFrom, startRealtime, stopRealtime, type RealtimeStatus } from '@/state/realtime'

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

interface PersistedShape {
  version: number
  session: SessionState
  theme: ThemeChoice
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
  view: ViewKey
  theme: ThemeChoice
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
  view: 'home',
  theme: 'system',
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
    applyLanguage(get().lang)

    // El escritorio usa el cliente HTTP nativo: sin CORS, Reddit, Mastodon y
    // RSS dejan de estar bloqueados. En el navegador se queda el `fetch` normal.
    getEngine().setFetch(await platformFetch())

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
      fetchImpl: globalThis.fetch,
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
  },

  setView: (view) => {
    set({ view })
    if (view !== 'search') set({ query: '' })
  },
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    scheduleSave(get)
  },
  setLang: (lang) => {
    applyLanguage(lang)
    set({ lang })
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
