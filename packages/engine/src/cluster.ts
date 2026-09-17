/**
 * Clustering incremental.
 *
 * No hay lotes ni reentrenamiento: cada item que llega se asigna a un tema
 * existente o abre uno nuevo, en tiempo constante respecto al histórico. Es la
 * pieza que convierte "1.284 publicaciones sobre lo mismo" en **una** historia.
 *
 * Algoritmo:
 *  1. Índice invertido doble: token → temas y entidad → temas (ventana de 6 h).
 *  2. Puntuación: 40 % Jaccard de palabras + 25 % similitud de simhash +
 *     35 % solape de entidades. La entidad es la señal que cruza idiomas:
 *     "OpenAI publica…" y "Nuevo modelo de OpenAI" no comparten casi palabras,
 *     pero sí entidad. Es un compromiso deliberado: dos historias distintas de
 *     la misma empresa pueden caer en el mismo tema, y el usuario ve *de qué*
 *     habla el tema en las palabras clave.
 *  3. Si la mejor candidata supera el umbral, el item se une; si no, abre tema.
 *  4. Fusión periódica de agrupaciones casi idénticas (evita temas gemelos).
 */
import { hammingDistance, jaccard, simhashSimilarity } from './text'
import type { Cluster, Item, SourceKind } from './types'

export interface ClusterOptions {
  /** Similitud mínima para unirse a un tema existente. */
  joinThreshold?: number
  /** Similitud mínima para fusionar dos temas. */
  mergeThreshold?: number
  /** Vida de un tema sin actividad nueva, en ms. */
  activeWindowMs?: number
  /** Máximo de tokens representativos por tema. */
  keywordLimit?: number
}

const DEFAULTS: Required<ClusterOptions> = {
  joinThreshold: 0.45,
  mergeThreshold: 0.62,
  activeWindowMs: 6 * 60 * 60 * 1000,
  keywordLimit: 8,
}

interface InternalCluster extends Cluster {
  keywords: string[]
  sources: SourceKind[]
}

export class Clusterer {
  private readonly options: Required<ClusterOptions>
  private readonly clusters = new Map<string, InternalCluster>()
  private readonly inverted = new Map<string, Set<string>>()
  private readonly entityIndex = new Map<string, Set<string>>()
  private sequence = 0

  constructor(options: ClusterOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  get size(): number {
    return this.clusters.size
  }

  /** Asigna un item ya normalizado a un tema. Muta `item.clusterId`. */
  assign(item: Item, tokens: string[]): Cluster {
    const now = item.publishedAt || item.ingestedAt
    const candidates = this.candidates(tokens, now, item.entities)

    let best: { cluster: InternalCluster; score: number } | null = null
    for (const cluster of candidates) {
      const keywordScore = jaccard(tokens, cluster.keywords)
      const hashScore = simhashSimilarity(item.simhash, cluster.centroid)
      const entityScore = jaccard(item.entities, cluster.entities)
      const score = keywordScore * 0.4 + hashScore * 0.25 + entityScore * 0.35
      if (!best || score > best.score) best = { cluster, score }
    }

    const cluster =
      best && best.score >= this.options.joinThreshold
        ? best.cluster
        : this.create(tokens, item)

    this.attach(cluster, item, tokens)
    return cluster
  }

  /** Fusiona temas que, con más datos, resultan ser la misma historia. */
  merge(now = Date.now()): string[] {
    const active = [...this.clusters.values()].filter(
      (cluster) => now - cluster.lastSeen <= this.options.activeWindowMs,
    )
    const merged: string[] = []
    for (let i = 0; i < active.length; i += 1) {
      const left = active[i]
      if (!left || !this.clusters.has(left.id)) continue
      for (let j = i + 1; j < active.length; j += 1) {
        const right = active[j]
        if (!right || !this.clusters.has(right.id)) continue
        const keywordScore = jaccard(left.keywords, right.keywords)
        const hashScore = simhashSimilarity(left.centroid, right.centroid)
        const entityScore = jaccard(left.entities, right.entities)
        if (keywordScore * 0.4 + hashScore * 0.25 + entityScore * 0.35 < this.options.mergeThreshold) continue
        merged.push(this.absorb(left, right))
      }
    }
    return merged
  }

  /** Olvida temas inactivos. Devuelve los ids retirados. */
  evict(now = Date.now()): string[] {
    const removed: string[] = []
    for (const cluster of [...this.clusters.values()]) {
      if (now - cluster.lastSeen <= this.options.activeWindowMs) continue
      this.remove(cluster.id)
      removed.push(cluster.id)
    }
    return removed
  }

  get(id: string): Cluster | undefined {
    return this.clusters.get(id)
  }

  all(): Cluster[] {
    return [...this.clusters.values()]
  }

  /** Temas tocados por un item: alimenta el cálculo de tendencias. */
  touch(item: Item, tokens: string[]): Cluster {
    return this.assign(item, tokens)
  }

  // ── interno ──────────────────────────────────────────────────────────────

  private candidates(tokens: string[], now: number, entities: string[] = []): InternalCluster[] {
    const scores = new Map<string, number>()
    for (const token of new Set(tokens)) {
      for (const id of this.inverted.get(token) ?? []) {
        scores.set(id, (scores.get(id) ?? 0) + 1)
      }
    }
    // Una entidad compartida es señal suficiente para considerarlo candidato,
    // aunque no comparta ni una palabra (p. ej. titulares en otro idioma).
    for (const entity of entities) {
      for (const id of this.entityIndex.get(entity) ?? []) {
        scores.set(id, (scores.get(id) ?? 0) + 3)
      }
    }
    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([id]) => this.clusters.get(id))
      .filter((cluster): cluster is InternalCluster => Boolean(cluster))
      .filter((cluster) => now - cluster.lastSeen <= this.options.activeWindowMs)
    return ranked
  }

  private create(tokens: string[], item: Item): InternalCluster {
    this.sequence += 1
    const keywords = this.pickKeywords(tokens)
    const cluster: InternalCluster = {
      id: `t${this.sequence.toString(36)}-${item.simhash.slice(0, 6)}`,
      keywords,
      entities: [...item.entities],
      itemIds: [],
      sources: [],
      firstSeen: item.publishedAt,
      lastSeen: item.publishedAt,
      centroid: item.simhash,
      corroborations: 0,
      lang: item.lang ?? 'und',
    }
    this.clusters.set(cluster.id, cluster)
    this.index(cluster)
    return cluster
  }

  private attach(cluster: InternalCluster, item: Item, tokens: string[]): void {
    if (cluster.itemIds.includes(item.id)) {
      cluster.corroborations += 1
      cluster.lastSeen = Math.max(cluster.lastSeen, item.publishedAt)
      return
    }

    cluster.itemIds.push(item.id)
    cluster.sources = [...new Set([...cluster.sources, item.source])]
    cluster.firstSeen = Math.min(cluster.firstSeen, item.publishedAt)
    cluster.lastSeen = Math.max(cluster.lastSeen, item.publishedAt)
    cluster.entities = [...new Set([...cluster.entities, ...item.entities])].slice(0, 12)
    // Centroide: media por bits frente al hash del item nuevo (ventana móvil).
    cluster.centroid = this.blendCentroid(cluster.centroid, item.simhash, cluster.itemIds.length)
    cluster.keywords = this.mergeKeywords(cluster.keywords, tokens)
    item.clusterId = cluster.id
    this.index(cluster)
  }

  /** Media bit a bit ponderada: el centroide se mueve, no salta. */
  private blendCentroid(centroid: string, hash: string, seen: number): string {
    const weight = Math.min(seen, 32)
    let out = 0n
    const left = BigInt(`0x${centroid}`)
    const right = BigInt(`0x${hash}`)
    for (let bit = 0; bit < 64; bit += 1) {
      const shift = BigInt(63 - bit)
      const vote = ((left >> shift) & 1n) === 1n ? weight : 0
      const incoming = ((right >> shift) & 1n) === 1n ? 1 : 0
      if (vote + incoming > weight / 2) out |= 1n << shift
    }
    return out.toString(16).padStart(16, '0')
  }

  private mergeKeywords(current: string[], tokens: string[]): string[] {
    const merged: string[] = []
    for (const token of [...current, ...this.pickKeywords(tokens)]) {
      if (!merged.includes(token)) merged.push(token)
      if (merged.length >= this.options.keywordLimit) break
    }
    return merged
  }

  /** Palabras más repetidas entre los tokens del item, sin diccionario global. */
  private pickKeywords(tokens: string[], limit = 5): string[] {
    const counts = new Map<string, number>()
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([token]) => token)
  }

  private index(cluster: InternalCluster): void {
    for (const token of cluster.keywords) {
      const bucket = this.inverted.get(token) ?? new Set<string>()
      bucket.add(cluster.id)
      this.inverted.set(token, bucket)
    }
    for (const entity of cluster.entities) {
      const bucket = this.entityIndex.get(entity) ?? new Set<string>()
      bucket.add(cluster.id)
      this.entityIndex.set(entity, bucket)
    }
  }

  private absorb(target: InternalCluster, source: InternalCluster): string {
    for (const id of source.itemIds) if (!target.itemIds.includes(id)) target.itemIds.push(id)
    target.sources = [...new Set([...target.sources, ...source.sources])]
    target.entities = [...new Set([...target.entities, ...source.entities])]
    target.keywords = this.mergeKeywords(target.keywords, source.keywords)
    target.firstSeen = Math.min(target.firstSeen, source.firstSeen)
    target.lastSeen = Math.max(target.lastSeen, source.lastSeen)
    target.corroborations += source.corroborations
    if (hammingDistance(target.centroid, source.centroid) > 0) {
      target.centroid = this.blendCentroid(target.centroid, source.centroid, target.itemIds.length)
    }
    this.remove(source.id)
    this.index(target)
    return source.id
  }

  private remove(id: string): void {
    this.clusters.delete(id)
    for (const bucket of this.inverted.values()) bucket.delete(id)
    for (const bucket of this.entityIndex.values()) bucket.delete(id)
  }
}
