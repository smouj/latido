/**
 * Modelo canónico de Latido.
 *
 * Todo lo que entra por un conector se traduce a `Item`. El resto del motor
 * (clustering, tendencias, alertas, UI) solo conoce estos tipos: añadir una red
 * nueva nunca cambia el núcleo.
 */

export type SourceKind =
  | 'bluesky'
  | 'reddit'
  | 'hackernews'
  | 'rss'
  | 'github'
  | 'mastodon'
  | 'youtube'
  | 'lemmy'
  | 'demo'

export type TrendState = 'quiet' | 'rising' | 'emerging' | 'breaking' | 'fading'

export type AlertKind =
  | 'topic_surge'
  | 'multi_source'
  | 'watched_entity'
  | 'keyword'
  | 'global_breaking'
  | 'project_velocity'

export interface Author {
  /** Identidad estable dentro de su red: `@handle@instancia` o `red:usuario`. */
  id: string
  handle: string
  displayName?: string
  avatarUrl?: string
  source: SourceKind
  url?: string
}

export interface ItemMetrics {
  likes?: number
  replies?: number
  reposts?: number
  score?: number
  comments?: number
  stars?: number
  /** Variación absoluta de métrica desde la observación anterior (GitHub, etc.). */
  delta?: number
}

export interface Item {
  /** `source:externalId`. Determinista: reingerir el mismo item no duplica. */
  id: string
  source: SourceKind
  externalId: string
  url: string
  title?: string
  body?: string
  lang?: string
  author: Author
  /** epoch ms, tal como lo publica la fuente. */
  publishedAt: number
  /** epoch ms, cuándo lo vio Latido por primera vez. */
  ingestedAt: number
  metrics: ItemMetrics
  tags: string[]
  /** Slugs de entidades detectadas (`sam-altman`, `openai`). */
  entities: string[]
  clusterId?: string
  /** Huella de 64 bits en hex para detectar duplicados casi idénticos. */
  simhash: string
  /** Exactamente qué pedía la fuente original. Se guarda para depurar el conector. */
  origin: string
}

export interface SourceStats {
  source: SourceKind
  share: number
  count: number
}

/** Un tema que está creciendo: agrupación + métricas derivadas. */
export interface Trend {
  id: string
  /** Nombre legible, generado a partir de las palabras dominantes. */
  title: string
  keywords: string[]
  entities: string[]
  /** 0–100. Orden por defecto del Radar. */
  score: number
  state: TrendState
  /** Veces que creció respecto a su línea base (>1 = acelerando). */
  velocity: number
  /** Variación proporcional en la última ventana, p. ej. 0.86 = +86 %. */
  growth: number
  volume: number
  coverage: number
  engagement: number
  novelty: number
  cohesion: number
  firstSeen: number
  lastSeen: number
  sources: SourceStats[]
  /** Serie temporal por cubos, para la barra y el sparkline. */
  sparkline: number[]
  /** Motivo estructurado; la UI lo traduce. */
  reason: TrendReason
  /** Muestra representativa para "Ver conversación". */
  sampleIds: string[]
  /** Latido ya visto por el usuario (para no volver a avisar). */
  acknowledged?: boolean
}

export interface TrendReason {
  code:
    | 'velocity_spike'
    | 'multi_source'
    | 'new_topic'
    | 'sustained'
    | 'project_velocity'
  params: Record<string, number | string>
}

export interface Cluster {
  id: string
  keywords: string[]
  entities: string[]
  itemIds: string[]
  sources: Set<SourceKind> | SourceKind[]
  firstSeen: number
  lastSeen: number
  /** Centroide de simhash por cubos de tiempo, para fusionar agrupaciones. */
  centroid: string
  /** Nº de items descartados por ser duplicado casi exacto. */
  corroborations: number
  lang: string
}

export interface AlertRule {
  id: string
  kind: AlertKind
  enabled: boolean
  /** Texto libre para keyword/entity. */
  query?: string
  /** Umbral de crecimiento (p. ej. 2.5 = ×2,5). */
  minGrowth?: number
  minSources?: number
  /** Solo estas fuentes cuentan para la regla. */
  sources?: SourceKind[]
  /** Silencio mínimo entre avisos del mismo tema, en ms. */
  cooldownMs?: number
  createdAt: number
}

export interface AlertEvent {
  id: string
  ruleId: string
  kind: AlertKind
  trendId: string
  title: string
  reason: TrendReason
  createdAt: number
  read: boolean
  /** Snapshot mínimo para pintar la notificación aunque el tema ya haya caducado. */
  snapshot: {
    score: number
    velocity: number
    growth: number
    coverage: number
    volume: number
    sources: SourceStats[]
  }
}

export interface Entity {
  /** slug estable: `openai`, `sam-altman`, `gtav`. */
  slug: string
  name: string
  kind: 'person' | 'org' | 'project' | 'topic' | 'place'
  aliases: string[]
  /** Fuentes donde tiene cuenta propia (Following). */
  accounts: Partial<Record<SourceKind, string>>
  /** Feeds/RSS o repos asociados. */
  links: { kind: string; url: string }[]
  watch: boolean
}

export interface Watchlist {
  id: string
  name: string
  entitySlugs: string[]
  keywords: string[]
  createdAt: number
}

export interface UserList {
  id: string
  name: string
  /** Slugs o `source:id` de autores. */
  members: string[]
  createdAt: number
}

export interface SourceConfig {
  kind: SourceKind
  enabled: boolean
  /** Parámetros propios: subreddits, feeds, instancias, términos de búsqueda. */
  options: Record<string, string | string[] | number | boolean>
  /** Algunas fuentes no permiten CORS: en web necesitan proxy, en escritorio no. */
  requiresProxy?: boolean
  /** Ritmo máximo de sondeo, en ms. */
  pollMs?: number
  /** Última vez que respondió bien (epoch ms). */
  lastOkAt?: number
  lastError?: string
}

export interface SessionState {
  /** Filtros activos del feed (chips). */
  filters: { topics: string[]; sources: SourceKind[]; onlyWatched: boolean; since: number | null }
  theme: 'dark' | 'light' | 'system'
  lang: 'es' | 'en'
  installedAt: number
  lastOpenedAt: number
  /** Ids ya leídos, para el contador de no leídos. */
  readIds: string[]
  bookmarks: string[]
  dismissed: string[]
}

export interface IngestResult {
  fetched: number
  inserted: number
  duplicates: number
  clustersTouched: string[]
  trendsUpdated: string[]
  errors: { source: SourceKind; message: string }[]
}
