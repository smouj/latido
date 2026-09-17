/**
 * El motor.
 *
 * Une las piezas: recoge de los conectores → normaliza → agrupa → mide
 * tendencias → dispara avisos. **No sabe nada de la interfaz y no guarda nada
 * por su cuenta**: todo pasa por el almacén que se le inyecta, así que se puede
 * ejecutar en Node (tests), en el navegador (modo web) o dentro de Tauri.
 */
import { evaluateAlerts, pruneFired, type AlertEvaluation } from './alerts'
import { Clusterer, type ClusterOptions } from './cluster'
import { ENTITY_SEED, normalizeItem, type RawItem } from './normalize'
import { CONNECTORS, defaultSourceConfigs } from './sources'
import { demoRawItems } from './sources/demo'
import type { Connector, FetchContext } from './sources/types'
import { MemoryStore, SNAPSHOT_VERSION, type ItemQuery, type StoreSnapshot } from './store'
import { tokenize } from './text'
import { TrendEngine, type TrendOptions } from './trend'
import type {
  AlertEvent,
  AlertRule,
  Entity,
  IngestResult,
  Item,
  SourceConfig,
  SourceKind,
  Trend,
} from './types'

export interface EngineOptions {
  store?: MemoryStore
  clusterOptions?: ClusterOptions
  trendOptions?: TrendOptions
  connectors?: Partial<Record<SourceKind, Connector>>
  sourceConfigs?: SourceConfig[]
  dictionary?: typeof ENTITY_SEED
  fetchImpl?: typeof fetch
  clock?: () => number
  /** Retención de items, en ms. Por defecto 30 días. */
  retentionMs?: number
  log?: (message: string) => void
}

const DAY = 86_400_000

export class LatidoEngine {
  readonly store: MemoryStore
  readonly sourceConfigs: Map<SourceKind, SourceConfig>

  private readonly clusterer: Clusterer
  private readonly trendEngine: TrendEngine
  private readonly connectors: Record<string, Connector>
  private readonly dictionary: typeof ENTITY_SEED
  private fetchImpl: typeof fetch
  private readonly clock: () => number
  private readonly retentionMs: number
  private readonly log: (message: string) => void
  private lastPollAt = new Map<SourceKind, number>()
  private listener: ((trends: Trend[], alerts: AlertEvent[]) => void) | null = null

  constructor(options: EngineOptions = {}) {
    this.store = options.store ?? new MemoryStore()
    this.clusterer = new Clusterer(options.clusterOptions)
    this.trendEngine = new TrendEngine(options.trendOptions)
    this.connectors = { ...CONNECTORS, ...options.connectors }
    this.dictionary = options.dictionary ?? ENTITY_SEED
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.clock = options.clock ?? (() => Date.now())
    this.retentionMs = options.retentionMs ?? 30 * DAY
    this.log = options.log ?? (() => {})

    const configs = options.sourceConfigs ?? defaultSourceConfigs()
    this.sourceConfigs = new Map(configs.map((config) => [config.kind, config]))
    this.seedEntities()
  }

  /** El diccionario de entidades entra al almacén para poder vigilarlas. */
  seedEntities(): Entity[] {
    const entities = Object.entries(this.dictionary).map<Entity>(([slug, entry]) => {
      const existing = this.store.getEntity(slug)
      return {
        slug,
        name: entry.name,
        kind: entry.kind,
        aliases: entry.aliases,
        accounts: existing?.accounts ?? {},
        links: existing?.links ?? [],
        watch: existing?.watch ?? false,
      }
    })
    this.store.putEntities(entities)
    return entities
  }

  onUpdate(listener: (trends: Trend[], alerts: AlertEvent[]) => void): void {
    this.listener = listener
  }

  /**
   * Cambia el cliente HTTP en caliente. El escritorio lo usa para pasar del
   * `fetch` del WebView al cliente nativo, que no sufre CORS.
   */
  setFetch(fetchImpl: typeof fetch): void {
    this.fetchImpl = fetchImpl
  }

  // ── ingesta ──────────────────────────────────────────────────────────────

  /**
   * Normaliza, agrupa y guarda. Idempotente: volver a ingerir lo mismo no
   * duplica nada, solo actualiza métricas al alza.
   *
   * Ojo con el agrupado: un item que ya está en el archivo **conserva su tema**.
   * Volver a agruparlo crearía un tema nuevo cada vez que se sondea la misma
   * fuente (y el tema viejo, caducado, se retiraría), con lo que el número de
   * temas crecería sin sentido y el Radar se llenaría de historias de un solo
   * item. Solo se agrupa de cero lo que no está, o lo que perdió su tema.
   */
  ingest(rawItems: RawItem[], now = this.clock()): IngestResult {
    const errors: IngestResult['errors'] = []
    const touched = new Set<string>()

    const normalized: Item[] = []
    for (const raw of rawItems) {
      try {
        const item = normalizeItem(raw, now, this.dictionary)
        const existing = this.store.getItem(item.id)
        const alive = existing?.clusterId ? this.clusterer.get(existing.clusterId) !== undefined : false

        if (existing && alive) {
          // Ya lo teníamos y su tema sigue vivo: solo se refrescan las métricas.
          normalized.push({ ...item, clusterId: existing.clusterId })
          if (existing.clusterId) touched.add(existing.clusterId)
          continue
        }

        const cluster = this.clusterer.assign(item, tokenize(`${item.title ?? ''} ${item.body ?? ''}`))
        touched.add(cluster.id)
        normalized.push(item)
      } catch (error) {
        errors.push({ source: raw.source, message: (error as Error).message })
      }
    }

    const { inserted, duplicates } = this.store.putItems(normalized)
    this.store.putClusters(this.clusterer.all())

    return {
      fetched: rawItems.length,
      inserted,
      duplicates,
      clustersTouched: [...touched],
      trendsUpdated: [],
      errors,
    }
  }

  /** Sondea las fuentes activas. Un fallo no cancela el resto. */
  async poll(kinds?: SourceKind[], options: { limit?: number } = {}): Promise<IngestResult> {
    const now = this.clock()
    const selected = (kinds ?? [...this.sourceConfigs.keys()]).filter(
      (kind) => this.sourceConfigs.get(kind)?.enabled && this.connectors[kind],
    )

    const outcome = await Promise.allSettled(
      selected.map(async (kind) => {
        const connector = this.connectors[kind]
        const config = this.sourceConfigs.get(kind)
        if (!connector || !config) return { kind, items: [] as RawItem[] }

        const context: FetchContext = {
          fetch: this.fetchImpl,
          now,
          limit: options.limit ?? 40,
          log: (message) => this.log(message),
        }
        try {
          const items = await connector.fetchItems(config, context)
          config.lastOkAt = this.clock()
          config.lastError = undefined
          this.lastPollAt.set(kind, config.lastOkAt)
          return { kind, items }
        } catch (error) {
          config.lastError = (error as Error).message
          this.log(`fuente ${kind}: ${config.lastError}`)
          return { kind, items: [] as RawItem[], error: (error as Error).message }
        }
      }),
    )

    const merged: IngestResult = {
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      clustersTouched: [],
      trendsUpdated: [],
      errors: [],
    }

    for (const result of outcome) {
      if (result.status === 'rejected') {
        merged.errors.push({ source: 'demo', message: String(result.reason) })
        continue
      }
      if (result.value.error) merged.errors.push({ source: result.value.kind, message: result.value.error })
      if (result.value.items.length === 0) continue
      const partial = this.ingest(result.value.items, now)
      merged.fetched += partial.fetched
      merged.inserted += partial.inserted
      merged.duplicates += partial.duplicates
      merged.clustersTouched.push(...partial.clustersTouched)
      merged.errors.push(...partial.errors)
    }

    merged.trendsUpdated = this.recompute(now).map((trend) => trend.id)
    return merged
  }

  // ── análisis ─────────────────────────────────────────────────────────────

  /** Recalcula tendencias, guarda la serie temporal y evalúa avisos. */
  recompute(now = this.clock()): Trend[] {
    // Fusionar temas gemelos y retirar los inactivos **antes** de medir: si no,
    // el Radar puede enseñar dos veces la misma historia (una por cada forma de
    // contarla) y los avisos se dispararían por duplicado.
    this.consolidate(now)

    const entityNames = Object.fromEntries(
      this.store.allEntities().map((entity) => [entity.slug, entity.name]),
    )
    // Solo los temas con publicaciones dentro del archivo: un tema sin items
    // (porque su contenido se podó por retención) no debe ocupar el Radar.
    const clusters = this.store
      .allClusters()
      .filter((cluster) => this.store.itemsByCluster(cluster.id).length > 0)
    const itemsByCluster = this.store.itemsByClusterMap(clusters.map((cluster) => cluster.id))
    const trends = this.trendEngine.evaluateAll(clusters, itemsByCluster, now, entityNames)

    this.store.putTrends(trends)
    // Coherencia de los contadores: un tema sin publicaciones en el archivo no
    // es un tema. Sin esto, el Radar y la salud del archivo acaban diciendo que
    // hay más temas que publicaciones, que es imposible.
    const live = new Set(clusters.map((cluster) => cluster.id))
    const stale = this.store.allClusters().filter((cluster) => !live.has(cluster.id))
    if (stale.length > 0) {
      for (const cluster of stale) this.clusterer.forget(cluster.id)
      this.store.removeClusters(stale.map((cluster) => cluster.id))
    }
    this.store.retainTrends(new Set(trends.map((trend) => trend.id)))
    this.store.saveTrendPoints(
      trends.map((trend) => ({
        trendId: trend.id,
        at: now - (now % 60_000),
        score: trend.score,
        volume: trend.volume,
        velocity: trend.velocity,
      })),
    )

    const evaluation = this.runAlerts(trends, itemsByCluster, now)
    this.retain(now)

    if (this.listener && trends.length > 0) this.listener(trends, evaluation.events)
    return trends
  }

  runAlerts(trends: Trend[], itemsByCluster: Map<string, Item[]>, now = this.clock()): AlertEvaluation {
    const rules = this.store.allAlertRules()
    const evaluation = evaluateAlerts({
      rules,
      trends,
      itemsByCluster,
      now,
      fired: this.store.getFired(),
    })
    this.store.putAlerts(evaluation.events)
    this.store.setFired(pruneFired(evaluation.fired, now))
    return evaluation
  }

  addRule(rule: Omit<AlertRule, 'createdAt'> & { createdAt?: number }): AlertRule {
    const created: AlertRule = {
      createdAt: rule.createdAt ?? this.clock(),
      id: rule.id,
      kind: rule.kind,
      enabled: rule.enabled,
      ...(rule.query !== undefined ? { query: rule.query } : {}),
      ...(rule.minGrowth !== undefined ? { minGrowth: rule.minGrowth } : {}),
      ...(rule.minSources !== undefined ? { minSources: rule.minSources } : {}),
      ...(rule.sources !== undefined ? { sources: rule.sources } : {}),
      ...(rule.cooldownMs !== undefined ? { cooldownMs: rule.cooldownMs } : {}),
    }
    this.store.putAlertRules([created])
    return created
  }

  /** Fusiona temas gemelos y descarta lo que ya no está activo. */
  consolidate(now = this.clock()): { merged: string[]; evicted: string[] } {
    return { merged: this.clusterer.merge(now), evicted: this.clusterer.evict(now) }
  }

  retain(now = this.clock()): { items: number; trends: number } {
    return this.store.prune(now - this.retentionMs)
  }

  // ── consultas de conveniencia ────────────────────────────────────────────

  feed(query: ItemQuery = {}): Item[] {
    return this.store.queryItems(query)
  }

  radar(options: { limit?: number; minScore?: number } = {}): Trend[] {
    // Un tema sin actividad en la ventana no es una tendencia: es una historia
    // vieja. Enseñarla como "0 publicaciones" solo ensuciaba el Radar.
    return this.store
      .queryTrends({ ...options, minScore: options.minScore ?? 1 })
      .filter((trend) => trend.volume > 0)
  }

  search(term: string, limit = 50): Item[] {
    return this.store.searchItems(term, limit)
  }

  /** Todo lo que habla de una entidad, venga de donde venga. */
  entityTimeline(slug: string, limit = 60): Item[] {
    return this.store.queryItems({ entities: [slug], limit })
  }

  stats(): ReturnType<MemoryStore['stats']> {
    return this.store.stats()
  }

  /** Carga los datos de ejemplo. Es lo que hace usable la app sin conexión. */
  loadDemo(now = this.clock()): IngestResult {
    return this.ingest(demoRawItems(now), now)
  }

  snapshot(): StoreSnapshot {
    return { ...this.store.snapshot(this.clock()), version: SNAPSHOT_VERSION }
  }

  hydrate(snapshot: StoreSnapshot): void {
    this.store.hydrate(snapshot)
    this.seedEntities()
    for (const cluster of this.store.allClusters()) {
      for (const item of this.store.itemsByCluster(cluster.id)) {
        this.clusterer.assign(item, tokenize(`${item.title ?? ''} ${item.body ?? ''}`))
      }
    }
  }
}
