import { describe, expect, it } from 'vitest'

import { bucketize, computeTrend, engagementOf, sourceBreakdown } from '../src/trend'
import { normalizeItem } from '../src/normalize'
import type { Cluster, Item, SourceKind, Trend } from '../src/types'

const NOW = 1_760_000_000_000
const OPTIONS = { windowMs: 30 * 60_000, bucketMs: 2 * 60_000, buckets: 15, baselineMs: 6 * 60 * 60_000 }

const SOURCES: SourceKind[] = ['bluesky', 'hackernews', 'reddit', 'mastodon', 'rss', 'github']

function itemsAt(offsetsMin: number[], sources: SourceKind[] = SOURCES): Item[] {
  return offsetsMin.map((minutes, index) => {
    const source = sources[index % sources.length] ?? 'rss'
    return normalizeItem(
      {
        source,
        externalId: `id-${minutes}-${index}`,
        url: `https://example.invalid/${minutes}-${index}`,
        title: `OpenAI anuncia un modelo nuevo ${index}`,
        body: 'Modelo nuevo de OpenAI con más contexto y menos coste',
        origin: 'test',
      },
      NOW - minutes * 60_000,
    )
  })
}

function clusterOf(items: Item[], firstSeenOffsetMin: number): Cluster {
  return {
    id: 'c1',
    keywords: ['openai', 'modelo', 'nuevo', 'contexto', 'coste'],
    entities: ['openai'],
    itemIds: items.map((item) => item.id),
    sources: SOURCES,
    firstSeen: NOW - firstSeenOffsetMin * 60_000,
    lastSeen: NOW,
    centroid: items[0]?.simhash ?? '0'.repeat(16),
    corroborations: 0,
    lang: 'es',
  }
}

describe('bucketize', () => {
  it('reparte los items en cubos y respeta la ventana', () => {
    const items = itemsAt([1, 3, 5, 40])
    const series = bucketize(items, NOW, OPTIONS)
    expect(series).toHaveLength(15)
    expect(series.reduce((sum, value) => sum + value, 0)).toBe(3)
  })
})

describe('engagementOf', () => {
  it('pondera reposts por encima de me gusta', () => {
    const [item] = itemsAt([1])
    if (!item) throw new Error('sin item')
    item.metrics = { likes: 10, reposts: 1 }
    expect(engagementOf([item])).toBe(13)
  })
})

describe('sourceBreakdown', () => {
  it('las cuotas suman uno', () => {
    const breakdown = sourceBreakdown(itemsAt([1, 2, 3, 4]))
    const total = breakdown.reduce((sum, entry) => sum + entry.share, 0)
    expect(total).toBeCloseTo(1, 6)
    expect(breakdown[0]?.count).toBeGreaterThanOrEqual(breakdown[breakdown.length - 1]?.count ?? 0)
  })
})

describe('computeTrend', () => {
  it('detecta una explosión y la marca como emergente', () => {
    const items = itemsAt([1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11])
    const trend = computeTrend({ cluster: clusterOf(items, 11), items, now: NOW, options: OPTIONS })
    expect(trend.volume).toBe(20)
    expect(trend.velocity).toBeGreaterThan(2.5)
    expect(trend.state).toBe('emerging')
    expect(trend.coverage).toBe(6)
    expect(trend.reason.code).toBe('multi_source')
    expect(trend.sparkline).toHaveLength(15)
  })

  it('deja en calma un goteo constante', () => {
    const offsets = Array.from({ length: 24 }, (_, index) => 5 + index * 15)
    const items = itemsAt(offsets)
    const burst = computeTrend({ cluster: clusterOf(itemsAt([1, 2, 3, 4, 5]), 5), items: itemsAt([1, 2, 3, 4, 5]), now: NOW, options: OPTIONS })
    const steady = computeTrend({ cluster: clusterOf(items, 360), items, now: NOW, options: OPTIONS })
    expect(steady.velocity).toBeLessThan(1.5)
    expect(steady.state).not.toBe('emerging')
    expect(steady.score).toBeLessThan(burst.score)
  })

  it('marca como breaking solo cuando hay volumen y corroboración', () => {
    const offsets = Array.from({ length: 40 }, (_, index) => 1 + Math.floor(index / 4))
    const items = itemsAt(offsets)
    const trend = computeTrend({ cluster: clusterOf(items, 11), items, now: NOW, options: OPTIONS })
    expect(trend.state).toBe('breaking')
    expect(trend.coverage).toBeGreaterThanOrEqual(3)
  })

  it('explica por qué aparece, con los números dentro', () => {
    const items = itemsAt([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const trend = computeTrend({ cluster: clusterOf(items, 9), items, now: NOW, options: OPTIONS })
    expect(trend.reason.params['volume']).toBe(9)
    expect(trend.reason.params['windowMin']).toBe(30)
    expect(trend.reason.params['growth']).toBeGreaterThanOrEqual(0)
  })

  it('un tema joven puntúa más alto que el mismo tema envejecido', () => {
    const items = itemsAt([1, 2, 3, 4, 5, 6])
    const fresh = computeTrend({ cluster: clusterOf(items, 6), items, now: NOW, options: OPTIONS })
    const old = computeTrend({ cluster: { ...clusterOf(items, 6), firstSeen: NOW - 5 * 60 * 60_000 }, items, now: NOW, options: OPTIONS })
    expect(fresh.novelty).toBeGreaterThan(old.novelty)
    expect(fresh.score).toBeGreaterThanOrEqual(old.score)
  })

  it('devuelve una tendencia utilizable sin items', () => {
    const empty: Trend = computeTrend({ cluster: clusterOf([], 5), items: [], now: NOW, options: OPTIONS })
    expect(empty.volume).toBe(0)
    expect(empty.score).toBe(0)
    expect(empty.title.length).toBeGreaterThan(0)
  })
})
