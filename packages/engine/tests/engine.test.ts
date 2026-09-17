import { describe, expect, it, vi } from 'vitest'

import { LatidoEngine } from '../src/engine'
import { demoRawItems } from '../src/sources/demo'
import { defaultSourceConfigs } from '../src/sources'
import type { SourceKind } from '../src/types'

const NOW = 1_760_000_000_000

function engineWithDemo(): LatidoEngine {
  return new LatidoEngine({
    clock: () => NOW,
    connectors: {
      demo: {
        kind: 'demo',
        label: 'ejemplo',
        requiresProxy: false,
        defaultPollMs: 1000,
        options: [],
        fetchItems: async (config, ctx) => demoRawItems(ctx.now),
      },
    },
    sourceConfigs: [{ kind: 'demo' as SourceKind, enabled: true, options: {} }],
  })
}

describe('LatidoEngine', () => {
  it('ingiere los datos de ejemplo y forma temas con varias fuentes', () => {
    const engine = engineWithDemo()
    const result = engine.loadDemo(NOW)
    expect(result.inserted).toBe(result.fetched)
    expect(result.errors).toEqual([])

    const trends = engine.recompute(NOW)
    expect(trends.length).toBeGreaterThanOrEqual(3)

    const openai = trends.find((trend) => trend.entities.includes('openai'))
    expect(openai).toBeDefined()
    expect(openai?.coverage).toBeGreaterThanOrEqual(4)
    expect(openai?.state === 'emerging' || openai?.state === 'breaking').toBe(true)
  })

  it('es idempotente: reingerir no duplica ni infla el feed', () => {
    const engine = engineWithDemo()
    engine.loadDemo(NOW)
    const before = engine.stats().items
    const second = engine.loadDemo(NOW)
    expect(second.inserted).toBe(0)
    expect(engine.stats().items).toBe(before)
  })

  it('ordena el radar por puntuación y guarda la serie temporal', () => {
    const engine = engineWithDemo()
    engine.loadDemo(NOW)
    const trends = engine.recompute(NOW)
    const scores = trends.map((trend) => trend.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(engine.store.trendSeries(trends[0]?.id ?? '').length).toBeGreaterThan(0)
  })

  it('dispara avisos solo cuando una regla se cumple', () => {
    const engine = engineWithDemo()
    engine.loadDemo(NOW)
    engine.addRule({ id: 'r1', kind: 'multi_source', enabled: true, minSources: 3, minGrowth: 0.5, cooldownMs: 60_000 })
    engine.recompute(NOW)
    const events = engine.store.allAlerts()
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]?.kind).toBe('multi_source')
  })

  it('busca y reconstruye la línea temporal de una entidad', () => {
    const engine = engineWithDemo()
    engine.loadDemo(NOW)
    engine.recompute(NOW)
    expect(engine.search('openai').length).toBeGreaterThan(0)
    expect(engine.entityTimeline('openai').length).toBeGreaterThan(0)
    expect(engine.entityTimeline('entidad-inexistente')).toHaveLength(0)
  })

  it('un fallo de red en una fuente no tumba el ciclo', async () => {
    const log = vi.fn()
    const engine = new LatidoEngine({
      clock: () => NOW,
      log,
      connectors: {
        rss: {
          kind: 'rss',
          label: 'rss',
          requiresProxy: true,
          defaultPollMs: 1000,
          options: [],
          fetchItems: async () => {
            throw new Error('sin conexión')
          },
        },
        hackernews: {
          kind: 'hackernews',
          label: 'hn',
          requiresProxy: false,
          defaultPollMs: 1000,
          options: [],
          fetchItems: async () => demoRawItems(NOW).slice(0, 3),
        },
      },
      sourceConfigs: [
        { kind: 'rss', enabled: true, options: {} },
        { kind: 'hackernews', enabled: true, options: {} },
      ],
    })

    const result = await engine.poll(['rss', 'hackernews'])
    expect(result.inserted).toBe(3)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.source).toBe('rss')
    expect(log).toHaveBeenCalled()
  })

  it('el sondeo respeta las fuentes desactivadas', async () => {
    const fetchItems = vi.fn(async () => demoRawItems(NOW))
    const engine = new LatidoEngine({
      clock: () => NOW,
      connectors: {
        rss: {
          kind: 'rss',
          label: 'rss',
          requiresProxy: true,
          defaultPollMs: 1000,
          options: [],
          fetchItems,
        },
      },
      sourceConfigs: [{ kind: 'rss', enabled: false, options: {} }],
    })
    const result = await engine.poll()
    expect(fetchItems).not.toHaveBeenCalled()
    expect(result.fetched).toBe(0)
  })

  it('sobrevive a un reinicio: instantánea y rehidratación', () => {
    const engine = engineWithDemo()
    engine.loadDemo(NOW)
    engine.recompute(NOW)
    const snapshot = engine.snapshot()

    const revived = new LatidoEngine({ clock: () => NOW, sourceConfigs: defaultSourceConfigs() })
    revived.hydrate(snapshot)
    expect(revived.stats().items).toBe(engine.stats().items)
    expect(revived.search('openai').length).toBeGreaterThan(0)
    const trends = revived.recompute(NOW)
    expect(trends.length).toBeGreaterThanOrEqual(3)
  })

  it('avisa a quien escucha cuando hay temas nuevos', () => {
    const engine = engineWithDemo()
    const listener = vi.fn()
    engine.onUpdate(listener)
    engine.loadDemo(NOW)
    engine.recompute(NOW)
    expect(listener).toHaveBeenCalled()
  })

  it('consolida sin perder temas activos', () => {
    const engine = engineWithDemo()
    engine.loadDemo(NOW)
    engine.recompute(NOW)
    const before = engine.radar().length
    engine.consolidate(NOW)
    expect(engine.radar().length).toBe(before)
  })
})
