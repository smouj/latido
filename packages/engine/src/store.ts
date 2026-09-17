/**
 * Almacén en memoria.
 *
 * Es la implementación de referencia del modelo: los tests corren contra ella y
 * el modo web la usa directamente, persistiendo una instantánea en IndexedDB.
 * El escritorio usa SQLite (mismo modelo, ver `store/schema.ts`).
 *
 * Regla de diseño: **todo lo que entra por aquí es determinista y ordenado**.
 * El motor nunca ordena por su cuenta; pedir "lo último" siempre devuelve lo
 * mismo para el mismo conjunto de datos.
 */
import { normalizeText } from './text'
import type {
  AlertEvent,
  AlertRule,
  Cluster,
  Entity,
  Item,
  SessionState,
  Trend,
  UserList,
  Watchlist,
} from './types'

export interface TrendPoint {
  trendId: string
  at: number
  score: number
  volume: number
  velocity: number
}

export interface StoreStats {
  items: number
  clusters: number
  trends: number
  alerts: number
  sources: number
  oldestItemAt: number | null
  newestItemAt: number | null
}

export interface ItemQuery {
  limit?: number
  since?: number
  sources?: string[]
  clusterId?: string
  entities?: string[]
  topics?: string[]
  bookmarkedOnly?: boolean
  unreadOnly?: boolean
  order?: 'recent' | 'engaged'
}

export interface StoreSnapshot {
  version: number
  savedAt: number
  items: Item[]
  clusters: Cluster[]
  trends: Trend[]
  points: TrendPoint[]
  alerts: AlertEvent[]
  rules: AlertRule[]
  fired: [string, number][]
  entities: Entity[]
  watchlists: Watchlist[]
  lists: UserList[]
  bookmarks: string[]
  kv: [string, string][]
  session: SessionState | null
}

export const SNAPSHOT_VERSION = 1

export function createSessionState(now = Date.now()): SessionState {
  return {
    filters: { topics: [], sources: [], onlyWatched: false, since: null },
    theme: 'system',
    lang: 'es',
    installedAt: now,
    lastOpenedAt: now,
    readIds: [],
    bookmarks: [],
    dismissed: [],
  }
}

export class MemoryStore {
  private items = new Map<string, Item>()
  private clusters = new Map<string, Cluster>()
  private trends = new Map<string, Trend>()
  private points = new Map<string, TrendPoint[]>()
  private alerts = new Map<string, AlertEvent>()
  private rules = new Map<string, AlertRule>()
  private fired = new Map<string, number>()
  private entities = new Map<string, Entity>()
  private watchlists = new Map<string, Watchlist>()
  private lists = new Map<string, UserList>()
  private bookmarks = new Set<string>()
  private read = new Set<string>()
  private kv = new Map<string, string>()
  private session: SessionState | null = null
  /** Índice invertido para búsqueda: token → ids de post. */
  private searchIndex = new Map<string, Set<string>>()

  constructor(snapshot?: StoreSnapshot) {
    if (snapshot) this.hydrate(snapshot)
  }

  // ── items ────────────────────────────────────────────────────────────────

  /** Inserta items nuevos. Devuelve cuántos entraron y cuántos ya existían. */
  putItems(items: Item[]): { inserted: number; duplicates: number } {
    let inserted = 0
    let duplicates = 0
    for (const item of items) {
      if (this.items.has(item.id)) {
        const existing = this.items.get(item.id)
        if (existing) this.items.set(item.id, mergeMetrics(existing, item))
        duplicates += 1
        continue
      }
      this.items.set(item.id, item)
      this.indexForSearch(item)
      inserted += 1
    }
    return { inserted, duplicates }
  }

  getItem(id: string): Item | undefined {
    return this.items.get(id)
  }

  itemCount(): number {
    return this.items.size
  }

  queryItems(query: ItemQuery = {}): Item[] {
    const limit = query.limit ?? 60
    const since = query.since ?? 0
    let result = [...this.items.values()].filter((item) => item.publishedAt >= since)

    if (query.sources && query.sources.length > 0) {
      result = result.filter((item) => query.sources?.includes(item.source))
    }
    if (query.clusterId) result = result.filter((item) => item.clusterId === query.clusterId)
    if (query.entities && query.entities.length > 0) {
      result = result.filter((item) => item.entities.some((slug) => query.entities?.includes(slug)))
    }
    if (query.topics && query.topics.length > 0) {
      result = result.filter((item) =>
        query.topics?.some((topic) => item.tags.includes(topic) || item.entities.includes(topic)),
      )
    }
    if (query.bookmarkedOnly) result = result.filter((item) => this.bookmarks.has(item.id))
    if (query.unreadOnly) result = result.filter((item) => !this.read.has(item.id))

    if (query.order === 'engaged') {
      result.sort((a, b) => engagementKey(b) - engagementKey(a) || b.publishedAt - a.publishedAt)
    } else {
      result.sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id))
    }
    return result.slice(0, limit)
  }

  itemsByCluster(clusterId: string): Item[] {
    return [...this.items.values()]
      .filter((item) => item.clusterId === clusterId)
      .sort((a, b) => b.publishedAt - a.publishedAt)
  }

  /** Agrupa por tema para el motor de tendencias. */
  itemsByClusterMap(clusterIds?: string[]): Map<string, Item[]> {
    const map = new Map<string, Item[]>()
    for (const clusterId of clusterIds ?? [...this.clusters.keys()]) map.set(clusterId, [])
    for (const item of this.items.values()) {
      if (!item.clusterId) continue
      const bucket = map.get(item.clusterId)
      if (bucket) bucket.push(item)
      else if (!clusterIds) map.set(item.clusterId, [item])
    }
    return map
  }

  searchItems(query: string, limit = 50): Item[] {
    const tokens = normalizeText(query).split(' ').filter((token) => token.length >= 2)
    if (tokens.length === 0) return []
    let candidateIds: Set<string> | null = null
    for (const token of tokens) {
      const bucket = this.searchIndex.get(token) ?? new Set<string>()
      if (candidateIds === null) {
        candidateIds = new Set(bucket)
      } else {
        const current: Set<string> = candidateIds
        candidateIds = new Set([...current].filter((id) => bucket.has(id)))
      }
      if (candidateIds.size === 0) break
    }
    const ids = candidateIds ?? new Set<string>()
    return [...ids]
      .map((id) => this.items.get(id))
      .filter((item): item is Item => Boolean(item))
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, limit)
  }

  markRead(ids: string[], read = true): void {
    for (const id of ids) {
      if (read) this.read.add(id)
      else this.read.delete(id)
    }
  }

  isRead(id: string): boolean {
    return this.read.has(id)
  }

  unreadCount(since = 0): number {
    let count = 0
    for (const item of this.items.values()) {
      if (item.publishedAt >= since && !this.read.has(item.id)) count += 1
    }
    return count
  }

  // ── clusters / trends ────────────────────────────────────────────────────

  putClusters(clusters: Cluster[]): void {
    for (const cluster of clusters) this.clusters.set(cluster.id, cluster)
  }

  getCluster(id: string): Cluster | undefined {
    return this.clusters.get(id)
  }

  allClusters(): Cluster[] {
    return [...this.clusters.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  }

  putTrends(trends: Trend[]): void {
    for (const trend of trends) {
      const previous = this.trends.get(trend.id)
      this.trends.set(trend.id, { ...trend, acknowledged: previous?.acknowledged ?? trend.acknowledged })
    }
  }

  getTrend(id: string): Trend | undefined {
    return this.trends.get(id)
  }

  /** Tendencias ordenadas por score. Filtra estados que el usuario no quiere ver. */
  queryTrends(options: { limit?: number; minScore?: number; states?: Trend['state'][] } = {}): Trend[] {
    const { limit = 40, minScore = 0, states } = options
    return [...this.trends.values()]
      .filter((trend) => trend.score >= minScore)
      .filter((trend) => !states || states.includes(trend.state))
      .sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen)
      .slice(0, limit)
  }

  acknowledgeTrend(id: string): void {
    const trend = this.trends.get(id)
    if (trend) this.trends.set(id, { ...trend, acknowledged: true })
  }

  saveTrendPoints(points: TrendPoint[]): void {
    for (const point of points) {
      const series = this.points.get(point.trendId) ?? []
      const withoutDupe = series.filter((entry) => entry.at !== point.at)
      withoutDupe.push(point)
      withoutDupe.sort((a, b) => a.at - b.at)
      // Ventana corta: solo interesa el último día, no un histórico infinito.
      this.points.set(point.trendId, withoutDupe.slice(-720))
    }
  }

  trendSeries(trendId: string): TrendPoint[] {
    return this.points.get(trendId) ?? []
  }

  // ── alertas ──────────────────────────────────────────────────────────────

  putAlertRules(rules: AlertRule[]): void {
    for (const rule of rules) this.rules.set(rule.id, rule)
  }

  allAlertRules(): AlertRule[] {
    return [...this.rules.values()]
  }

  removeAlertRule(id: string): void {
    this.rules.delete(id)
  }

  toggleAlertRule(id: string): AlertRule | undefined {
    const rule = this.rules.get(id)
    if (!rule) return undefined
    const next: AlertRule = { ...rule, enabled: !rule.enabled }
    this.rules.set(id, next)
    return next
  }

  putAlerts(events: AlertEvent[]): void {
    for (const event of events) this.alerts.set(event.id, event)
  }

  allAlerts(limit = 100): AlertEvent[] {
    return [...this.alerts.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  }

  markAlertsRead(ids: string[]): void {
    for (const id of ids) {
      const event = this.alerts.get(id)
      if (event) this.alerts.set(id, { ...event, read: true })
    }
  }

  unreadAlerts(): number {
    return [...this.alerts.values()].filter((event) => !event.read).length
  }

  setFired(map: Map<string, number>): void {
    this.fired = new Map(map)
  }

  getFired(): Map<string, number> {
    return new Map(this.fired)
  }

  // ── entidades, listas, marcadores ────────────────────────────────────────

  putEntities(entities: Entity[]): void {
    for (const entity of entities) this.entities.set(entity.slug, entity)
  }

  getEntity(slug: string): Entity | undefined {
    return this.entities.get(slug)
  }

  allEntities(): Entity[] {
    return [...this.entities.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  watchedEntities(): Entity[] {
    return this.allEntities().filter((entity) => entity.watch)
  }

  putWatchlists(watchlists: Watchlist[]): void {
    for (const list of watchlists) this.watchlists.set(list.id, list)
  }

  allWatchlists(): Watchlist[] {
    return [...this.watchlists.values()]
  }

  putLists(lists: UserList[]): void {
    for (const list of lists) this.lists.set(list.id, list)
  }

  removeList(id: string): void {
    this.lists.delete(id)
  }

  allLists(): UserList[] {
    return [...this.lists.values()]
  }

  addBookmark(id: string): void {
    this.bookmarks.add(id)
  }

  removeBookmark(id: string): void {
    this.bookmarks.delete(id)
  }

  isBookmarked(id: string): boolean {
    return this.bookmarks.has(id)
  }

  allBookmarks(): string[] {
    return [...this.bookmarks.values()]
  }

  // ── clave-valor y sesión ─────────────────────────────────────────────────

  set(key: string, value: string): void {
    this.kv.set(key, value)
  }

  get(key: string): string | undefined {
    return this.kv.get(key)
  }

  saveSession(session: SessionState): void {
    this.session = session
  }

  loadSession(): SessionState | null {
    return this.session
  }

  // ── diagnóstico ──────────────────────────────────────────────────────────

  stats(): StoreStats {
    const times = [...this.items.values()].map((item) => item.publishedAt)
    return {
      items: this.items.size,
      clusters: this.clusters.size,
      trends: this.trends.size,
      alerts: this.alerts.size,
      sources: new Set([...this.items.values()].map((item) => item.source)).size,
      oldestItemAt: times.length > 0 ? Math.min(...times) : null,
      newestItemAt: times.length > 0 ? Math.max(...times) : null,
    }
  }

  /** Retención: borra lo viejo. El escritorio hace lo mismo con SQL (más rápido). */
  prune(olderThan: number): { items: number; trends: number } {
    let itemsRemoved = 0
    for (const [id, item] of [...this.items.entries()]) {
      if (item.publishedAt >= olderThan) continue
      this.items.delete(id)
      this.deindexForSearch(item)
      itemsRemoved += 1
    }
    let trendsRemoved = 0
    for (const [id, trend] of [...this.trends.entries()]) {
      if (trend.lastSeen >= olderThan || !trend.acknowledged) continue
      this.trends.delete(id)
      this.points.delete(id)
      trendsRemoved += 1
    }
    return { items: itemsRemoved, trends: trendsRemoved }
  }

  // ── persistencia ─────────────────────────────────────────────────────────

  snapshot(now = Date.now()): StoreSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      savedAt: now,
      items: [...this.items.values()],
      clusters: [...this.clusters.values()],
      trends: [...this.trends.values()],
      points: [...this.points.values()].flat(),
      alerts: [...this.alerts.values()],
      rules: [...this.rules.values()],
      fired: [...this.fired.entries()],
      entities: [...this.entities.values()],
      watchlists: [...this.watchlists.values()],
      lists: [...this.lists.values()],
      bookmarks: [...this.bookmarks.values()],
      kv: [...this.kv.entries()],
      session: this.session,
    }
  }

  hydrate(snapshot: StoreSnapshot): void {
    this.items = new Map(snapshot.items.map((item) => [item.id, item]))
    this.clusters = new Map(snapshot.clusters.map((cluster) => [cluster.id, cluster]))
    this.trends = new Map(snapshot.trends.map((trend) => [trend.id, trend]))
    this.points = new Map()
    this.saveTrendPoints(snapshot.points)
    this.alerts = new Map(snapshot.alerts.map((event) => [event.id, event]))
    this.rules = new Map(snapshot.rules.map((rule) => [rule.id, rule]))
    this.fired = new Map(snapshot.fired)
    this.entities = new Map(snapshot.entities.map((entity) => [entity.slug, entity]))
    this.watchlists = new Map(snapshot.watchlists.map((list) => [list.id, list]))
    this.lists = new Map(snapshot.lists.map((list) => [list.id, list]))
    this.bookmarks = new Set(snapshot.bookmarks)
    this.kv = new Map(snapshot.kv)
    this.session = snapshot.session
    this.searchIndex = new Map()
    for (const item of this.items.values()) this.indexForSearch(item)
  }

  // ── interno ──────────────────────────────────────────────────────────────

  private indexForSearch(item: Item): void {
    const text = normalizeText([item.title ?? '', item.body ?? '', item.tags.join(' ')].join(' '))
    for (const token of new Set(text.split(' ').filter((entry) => entry.length >= 2))) {
      const bucket = this.searchIndex.get(token) ?? new Set<string>()
      bucket.add(item.id)
      this.searchIndex.set(token, bucket)
    }
  }

  private deindexForSearch(item: Item): void {
    for (const bucket of this.searchIndex.values()) bucket.delete(item.id)
  }
}

function engagementKey(item: Item): number {
  const { likes = 0, replies = 0, reposts = 0, comments = 0, stars = 0 } = item.metrics
  return likes + replies * 2 + reposts * 3 + comments * 1.5 + stars * 2
}

/** Conserva el mayor valor observado de cada métrica (nunca "des-aprende"). */
function mergeMetrics(previous: Item, incoming: Item): Item {
  return {
    ...previous,
    metrics: {
      likes: Math.max(previous.metrics.likes ?? 0, incoming.metrics.likes ?? 0),
      replies: Math.max(previous.metrics.replies ?? 0, incoming.metrics.replies ?? 0),
      reposts: Math.max(previous.metrics.reposts ?? 0, incoming.metrics.reposts ?? 0),
      comments: Math.max(previous.metrics.comments ?? 0, incoming.metrics.comments ?? 0),
      stars: Math.max(previous.metrics.stars ?? 0, incoming.metrics.stars ?? 0),
      score: Math.max(previous.metrics.score ?? 0, incoming.metrics.score ?? 0),
      delta: incoming.metrics.delta ?? previous.metrics.delta ?? 0,
    },
  }
}
