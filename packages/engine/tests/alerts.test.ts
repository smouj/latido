import { describe, expect, it } from 'vitest'

import { createRule, evaluateAlerts, pruneFired } from '../src/alerts'
import type { AlertRule, Item, Trend } from '../src/types'

const NOW = 1_760_000_000_000

function trend(overrides: Partial<Trend> = {}): Trend {
  return {
    id: 'c1',
    title: 'OpenAI',
    keywords: ['openai', 'modelo'],
    entities: ['openai'],
    score: 72,
    state: 'emerging',
    velocity: 4.2,
    growth: 2.5,
    volume: 18,
    coverage: 4,
    engagement: 1200,
    novelty: 0.9,
    cohesion: 0.7,
    firstSeen: NOW - 10 * 60_000,
    lastSeen: NOW,
    sources: [
      { source: 'bluesky', share: 0.5, count: 9 },
      { source: 'reddit', share: 0.3, count: 5 },
      { source: 'hackernews', share: 0.2, count: 4 },
    ],
    sparkline: new Array<number>(15).fill(1),
    reason: { code: 'multi_source', params: { velocity: 4.2, growth: 250, sources: 4, volume: 18, windowMin: 30 } },
    sampleIds: ['a', 'b'],
    ...overrides,
  }
}

function item(text: string): Item {
  return {
    id: 'i1',
    source: 'reddit',
    externalId: 'i1',
    url: 'https://example.invalid/i1',
    title: text,
    body: text,
    author: { id: 'reddit:x', handle: 'u/x', source: 'reddit' },
    publishedAt: NOW,
    ingestedAt: NOW,
    metrics: {},
    tags: [],
    entities: ['openai'],
    simhash: '0'.repeat(16),
    origin: 'test',
    lang: 'es',
  }
}

describe('evaluateAlerts', () => {
  const multiSource: AlertRule = createRule({
    id: 'r-multi',
    kind: 'multi_source',
    enabled: true,
    minSources: 3,
    minGrowth: 1,
    cooldownMs: 60_000,
  })

  it('dispara cuando un tema crece y aparece en varias redes', () => {
    const result = evaluateAlerts({
      rules: [multiSource],
      trends: [trend()],
      itemsByCluster: new Map([['c1', [item('OpenAI anuncia un modelo nuevo')]]]),
      now: NOW,
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.kind).toBe('multi_source')
    expect(result.events[0]?.snapshot.coverage).toBe(4)
    expect(result.events[0]?.read).toBe(false)
  })

  it('respeta el enfriamiento y no repite el aviso', () => {
    const first = evaluateAlerts({ rules: [multiSource], trends: [trend()], itemsByCluster: new Map(), now: NOW })
    const second = evaluateAlerts({
      rules: [multiSource],
      trends: [trend()],
      itemsByCluster: new Map(),
      now: NOW + 1000,
      fired: first.fired,
    })
    const third = evaluateAlerts({
      rules: [multiSource],
      trends: [trend()],
      itemsByCluster: new Map(),
      now: NOW + 61_000,
      fired: second.fired,
    })
    expect(second.events).toHaveLength(0)
    expect(third.events).toHaveLength(1)
  })

  it('ignora temas que crecen poco o con poca cobertura', () => {
    const result = evaluateAlerts({
      rules: [multiSource],
      trends: [trend({ growth: 0.2 }), trend({ id: 'c2', coverage: 1 })],
      itemsByCluster: new Map(),
      now: NOW,
    })
    expect(result.events).toHaveLength(0)
  })

  it('no evalúa reglas desactivadas', () => {
    const result = evaluateAlerts({
      rules: [{ ...multiSource, enabled: false }],
      trends: [trend()],
      itemsByCluster: new Map(),
      now: NOW,
    })
    expect(result.events).toHaveLength(0)
  })

  it('las reglas por palabra clave buscan en el texto', () => {
    const rule: AlertRule = createRule({ id: 'r-kw', kind: 'keyword', enabled: true, query: 'benchmark', minGrowth: 0 })
    const hit = evaluateAlerts({
      rules: [rule],
      trends: [trend()],
      itemsByCluster: new Map([['c1', [item('OpenAI publica los benchmark del modelo nuevo')]]]),
      now: NOW,
    })
    const miss = evaluateAlerts({
      rules: [rule],
      trends: [trend()],
      itemsByCluster: new Map([['c1', [item('OpenAI anuncia algo distinto')]]]),
      now: NOW,
    })
    expect(hit.events).toHaveLength(1)
    expect(miss.events).toHaveLength(0)
  })

  it('las reglas de entidad vigilada solo disparan con esa entidad', () => {
    const rule: AlertRule = createRule({ id: 'r-ent', kind: 'watched_entity', enabled: true, query: 'gtavi', minGrowth: 0 })
    const result = evaluateAlerts({
      rules: [rule],
      trends: [trend({ entities: ['gtavi'] }), trend({ id: 'c2' })],
      itemsByCluster: new Map(),
      now: NOW,
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.trendId).toBe('c1')
  })

  it('filtra por fuentes cuando la regla lo pide', () => {
    const rule: AlertRule = createRule({ id: 'r-src', kind: 'topic_surge', enabled: true, minGrowth: 0, sources: ['github'] })
    const result = evaluateAlerts({ rules: [rule], trends: [trend()], itemsByCluster: new Map(), now: NOW })
    expect(result.events).toHaveLength(0)
  })
})

describe('pruneFired', () => {
  it('olvida los avisos antiguos para no crecer sin límite', () => {
    const fired = new Map([
      ['viejo', NOW - 48 * 60 * 60 * 1000],
      ['nuevo', NOW - 60_000],
    ])
    const pruned = pruneFired(fired, NOW)
    expect(pruned.has('viejo')).toBe(false)
    expect(pruned.has('nuevo')).toBe(true)
  })
})
