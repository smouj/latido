/**
 * Trend Engine.
 *
 * Convierte agrupaciones en respuestas a "¿esto está empezando a pasar?".
 * Todo el cálculo es una función pura sobre los items del tema, así que el
 * resultado es reproducible y testeable sin red ni reloj real.
 *
 * Vocabulario:
 *  - `velocity`  volumen por cubo ahora ÷ línea base de las últimas 6 h.
 *  - `growth`    variación de la última ventana frente a la anterior.
 *  - `coverage`  cuántas redes distintas hablan del tema (corroboración).
 *  - `novelty`   un tema joven puntúa más alto que el mismo tema 6 h después.
 *  - `score`     0–100, media ponderada normalizada. Orden del Radar.
 */
import { firstLine, simhashSimilarity, titleFromKeywords } from './text'
import type { Cluster, Item, SourceKind, SourceStats, Trend, TrendReason, TrendState } from './types'

export interface TrendOptions {
  /** Ventana de análisis. */
  windowMs?: number
  /** Tamaño de cubo de la serie temporal. */
  bucketMs?: number
  /** Cubos visibles en el sparkline. */
  buckets?: number
  /** Histórico para la línea base. */
  baselineMs?: number
  /** Peso relativo de cada señal en el score. */
  weights?: { volume: number; velocity: number; coverage: number; engagement: number; novelty: number }
}

const DEFAULTS: Required<TrendOptions> = {
  windowMs: 30 * 60 * 1000,
  bucketMs: 2 * 60 * 1000,
  buckets: 15,
  baselineMs: 6 * 60 * 60 * 1000,
  weights: { volume: 0.34, velocity: 0.3, coverage: 0.16, engagement: 0.12, novelty: 0.08 },
}

export interface TrendInput {
  cluster: Cluster
  items: Item[]
  now: number
  entityNames?: Record<string, string>
  options?: TrendOptions
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)
/** Normalizador logarítmico: saturar a partir de `ceiling`. */
const norm = (value: number, ceiling: number): number =>
  clamp01(Math.log1p(Math.max(0, value)) / Math.log1p(ceiling))

/**
 * Histograma de items en cubos de `bucketMs`, del más antiguo al más nuevo.
 *
 * El índice se calcula **desde el ahora**, no desde el inicio de la ventana: así
 * un item publicado en este mismo instante cae en el último cubo en lugar de
 * quedarse fuera de la serie.
 */
export function bucketize(items: Item[], now: number, options: TrendOptions = {}): number[] {
  const { bucketMs, buckets } = { ...DEFAULTS, ...options }
  const counts = new Array<number>(buckets).fill(0)
  for (const item of items) {
    const age = now - item.publishedAt
    if (age < 0) continue
    const index = buckets - 1 - Math.floor(age / bucketMs)
    if (index < 0) continue
    const slot = Math.min(index, buckets - 1)
    counts[slot] = (counts[slot] ?? 0) + 1
  }
  return counts
}

/** Suma de métricas ponderadas: un repost vale más que un "me gusta". */
export function engagementOf(items: Item[]): number {
  let total = 0
  for (const item of items) {
    const { likes = 0, replies = 0, reposts = 0, comments = 0, stars = 0, score = 0, delta = 0 } = item.metrics
    total += likes + replies * 2 + reposts * 3 + comments * 1.5 + stars * 2 + score * 0.5 + Math.max(0, delta) * 2
  }
  return total
}

export function sourceBreakdown(items: Item[]): SourceStats[] {
  const counts = new Map<SourceKind, number>()
  for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
  const total = items.length || 1
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
}

/** Media de similitud de los items con su centroide, aproximada por dispersión temporal. */
export function cohesionOf(items: Item[]): number {
  if (items.length < 2) return 1
  const times = items.map((item) => item.publishedAt).sort((a, b) => a - b)
  const first = times[0] ?? 0
  const last = times[times.length - 1] ?? first
  const spanMin = (last - first) / 60000
  const density = items.length / Math.max(spanMin, 1)
  return clamp01(1 - density / 12)
}

function noveltyOf(firstSeen: number, now: number, baselineMs: number): number {
  const age = Math.max(0, now - firstSeen)
  return clamp01(1 - age / baselineMs)
}

/**
 * Item más representativo del tema: el que más se parece al centroide.
 *
 * Es la diferencia entre un título legible —"Show HN: Share your AI Setup"— y
 * una lista de palabras sueltas —"associate · become · canada"—. Cuando hay
 * entidades, mandan ellas; cuando no, manda el titular real de alguien.
 */
export function representativeItem(items: Item[]): Item | undefined {
  const first = items[0]
  if (!first) return undefined
  if (items.length === 1) return first
  let best = first
  let bestScore = -1
  // La ventana puede ser larga: basta con mirar los más recientes, que es lo que
  // el lector va a reconocer.
  for (const item of items.slice(0, 24)) {
    const score = simhashSimilarity(item.simhash, items[0]?.simhash ?? item.simhash)
    const weighted = score + (item.title ? 0.05 : 0)
    if (weighted > bestScore) {
      bestScore = weighted
      best = item
    }
  }
  return best
}

function titleOf(items: Item[], keywords: string[], entityLabels: string[]): string {
  if (entityLabels.length > 0) return entityLabels.slice(0, 2).join(' · ')
  const representative = representativeItem(items)
  const text = representative?.title?.trim() || representative?.body?.trim() || ''
  if (text.length >= 12) return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text
  return titleFromKeywords(keywords, text)
}

function stateOf(input: { velocity: number; coverage: number; volume: number; ageMin: number }): TrendState {
  const { velocity, coverage, volume, ageMin } = input
  if (coverage >= 3 && velocity >= 5 && volume >= 25) return 'breaking'
  if (velocity >= 2.5 && volume >= 8 && ageMin <= 90) return 'emerging'
  if (velocity >= 1.6) return 'rising'
  if (velocity < 0.6 && ageMin > 30) return 'fading'
  return 'quiet'
}

function reasonOf(input: {
  velocity: number
  growth: number
  coverage: number
  volume: number
  ageMin: number
  windowMin: number
  sources: SourceStats[]
}): TrendReason {
  const params = {
    velocity: Math.round(input.velocity * 10) / 10,
    growth: Math.round(input.growth * 100),
    sources: input.coverage,
    volume: input.volume,
    windowMin: input.windowMin,
  }
  if (input.coverage >= 3 && input.velocity >= 2.5) return { code: 'multi_source', params }
  if (input.velocity >= 3) return { code: 'velocity_spike', params }
  if (input.ageMin <= 20 && input.volume >= 5) return { code: 'new_topic', params }
  return { code: 'sustained', params }
}

export function computeTrend(input: TrendInput): Trend {
  const options = { ...DEFAULTS, ...input.options }
  const { cluster, items, now, entityNames = {} } = input

  const window = items.filter((item) => now - item.publishedAt <= options.windowMs)
  const series = bucketize(window, now, options)
  // El corte es `slice(half)`: entre el último cubo «anterior» y el primero
  // «reciente» no puede quedar ningún cubo suelto sin contar.
  const half = Math.floor(options.buckets / 2)
  const recentBuckets = options.buckets - half
  const recent = series.slice(half).reduce((sum, value) => sum + value, 0)
  const previous = series.slice(0, half).reduce((sum, value) => sum + value, 0)

  const growth = (recent - previous) / Math.max(previous, 1)
  const baselineItems = items.filter(
    (item) => now - item.publishedAt > options.windowMs && now - item.publishedAt <= options.baselineMs,
  )
  const baselineBuckets = Math.max(1, Math.round((options.baselineMs - options.windowMs) / options.bucketMs))
  const baselineRate = baselineItems.length / baselineBuckets
  const recentRate = recent / recentBuckets
  const velocity = recentRate / Math.max(baselineRate, 0.25)

  const sources = sourceBreakdown(window)
  const coverage = sources.length
  const volume = window.length
  const engagement = engagementOf(window)
  const ageMin = (now - cluster.firstSeen) / 60000
  const novelty = noveltyOf(cluster.firstSeen, now, options.baselineMs)

  const weights = options.weights
  // Sin publicaciones no hay pulso: evita que un tema vacío puntúe por novedad.
  const score =
    volume === 0
      ? 0
      : Math.round(
          100 *
            clamp01(
              weights.volume * norm(volume, 300) +
                weights.velocity * norm(velocity, 12) +
                weights.coverage * clamp01((coverage - 1) / 4) +
                weights.engagement * norm(engagement, 50000) +
                weights.novelty * novelty,
            ),
        )

  const keywords = cluster.keywords.slice(0, 8)
  const entityLabels = cluster.entities
    .map((slug) => entityNames[slug] ?? slug)
    .filter((label) => label.length > 0)
  const title = titleOf(window.length > 0 ? window : items, keywords, entityLabels)

  return {
    id: cluster.id,
    title,
    keywords,
    entities: cluster.entities,
    score,
    state: stateOf({ velocity, coverage, volume, ageMin }),
    velocity: Math.round(velocity * 100) / 100,
    growth: Math.round(growth * 1000) / 1000,
    volume,
    coverage,
    engagement: Math.round(engagement),
    novelty: Math.round(novelty * 100) / 100,
    cohesion: Math.round(cohesionOf(items) * 100) / 100,
    firstSeen: cluster.firstSeen,
    lastSeen: cluster.lastSeen,
    sources,
    sparkline: series,
    reason: reasonOf({
      velocity,
      growth,
      coverage,
      volume,
      ageMin,
      windowMin: options.windowMs / 60000,
      sources,
    }),
    sampleIds: window
      .slice()
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, 8)
      .map((item) => item.id),
  }
}

/**
 * Motor con memoria: guarda la última foto de cada tema para detectar subidas
 * sostenidas y evitar que un pico puntual vuelva a disparar avisos.
 */
export class TrendEngine {
  private readonly options: Required<TrendOptions>
  private readonly previous = new Map<string, { score: number; velocity: number; at: number }>()

  constructor(options: TrendOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  evaluate(cluster: Cluster, items: Item[], now: number, entityNames: Record<string, string> = {}): Trend {
    const trend = computeTrend({ cluster, items, now, entityNames, options: this.options })
    this.previous.set(cluster.id, { score: trend.score, velocity: trend.velocity, at: now })
    return trend
  }

  evaluateAll(
    clusters: Cluster[],
    itemsByCluster: Map<string, Item[]>,
    now: number,
    entityNames: Record<string, string> = {},
  ): Trend[] {
    return clusters
      .map((cluster) => this.evaluate(cluster, itemsByCluster.get(cluster.id) ?? [], now, entityNames))
      .sort((a, b) => b.score - a.score || b.volume - a.volume)
  }

  /** ¿El tema subió de estado desde la última evaluación? */
  escalated(trend: Trend): boolean {
    const before = this.previous.get(trend.id)
    if (!before) return trend.state !== 'quiet'
    return trend.velocity >= before.velocity * 1.5 && trend.score >= before.score + 5
  }
}
