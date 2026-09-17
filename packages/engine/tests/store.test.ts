import { describe, expect, it } from 'vitest'

import { MemoryStore, createSessionState } from '../src/store'
import { normalizeItem } from '../src/normalize'
import type { Item, Trend } from '../src/types'

const NOW = 1_760_000_000_000

function item(id: string, minutesAgo: number, text = 'OpenAI anuncia un modelo nuevo', source: Item['source'] = 'reddit'): Item {
  return normalizeItem(
    { source, externalId: id, url: `https://example.invalid/${id}`, title: text, body: text, origin: 'test' },
    NOW - minutesAgo * 60_000,
  )
}

function trend(id: string): Trend {
  return {
    id,
    title: 'OpenAI',
    keywords: ['openai'],
    entities: ['openai'],
    score: 50,
    state: 'rising',
    velocity: 2,
    growth: 0.5,
    volume: 4,
    coverage: 2,
    engagement: 10,
    novelty: 0.5,
    cohesion: 0.5,
    firstSeen: NOW,
    lastSeen: NOW,
    sources: [{ source: 'reddit', share: 1, count: 4 }],
    sparkline: [],
    reason: { code: 'sustained', params: {} },
    sampleIds: [],
  }
}

describe('MemoryStore', () => {
  it('no duplica y conserva la métrica más alta', () => {
    const store = new MemoryStore()
    const first = item('a', 5)
    first.metrics = { likes: 10 }
    const second = { ...item('a', 5), metrics: { likes: 99 } }

    expect(store.putItems([first]).inserted).toBe(1)
    expect(store.putItems([second]).duplicates).toBe(1)
    expect(store.getItem(first.id)?.metrics.likes).toBe(99)
    expect(store.itemCount()).toBe(1)
  })

  it('ordena el feed de más nuevo a más viejo y respeta el límite', () => {
    const store = new MemoryStore()
    store.putItems([item('a', 30), item('b', 1), item('c', 10)])
    const feed = store.queryItems({ limit: 2 })
    expect(feed.map((entry) => entry.externalId)).toEqual(['b', 'c'])
  })

  it('filtra por fuente, entidad y marcador', () => {
    const store = new MemoryStore()
    const news = item('a', 5, 'OpenAI anuncia un modelo nuevo', 'hackernews')
    const other = item('b', 6, 'NVIDIA sube precios')
    store.putItems([news, other])
    store.addBookmark(news.id)

    expect(store.queryItems({ sources: ['hackernews'] })).toHaveLength(1)
    expect(store.queryItems({ entities: ['nvidia'] })).toHaveLength(1)
    expect(store.queryItems({ bookmarkedOnly: true })).toHaveLength(1)
  })

  it('busca por texto sin acentos ni mayúsculas', () => {
    const store = new MemoryStore()
    store.putItems([item('a', 5, 'El modelo de OpenAI bate récords'), item('b', 6, 'NVIDIA sube precios')])
    expect(store.searchItems('modelo')).toHaveLength(1)
    expect(store.searchItems('RÉCORDS')).toHaveLength(1)
    expect(store.searchItems('nada de esto')).toHaveLength(0)
    expect(store.searchItems('')).toHaveLength(0)
  })

  it('cuenta no leídos y los marca', () => {
    const store = new MemoryStore()
    const entries = [item('a', 5), item('b', 4)]
    store.putItems(entries)
    expect(store.unreadCount()).toBe(2)
    store.markRead([entries[0]?.id ?? ''])
    expect(store.unreadCount()).toBe(1)
    store.markRead([entries[0]?.id ?? ''], false)
    expect(store.unreadCount()).toBe(2)
  })

  it('guarda series de tendencia sin repetir el mismo instante', () => {
    const store = new MemoryStore()
    store.saveTrendPoints([{ trendId: 't1', at: NOW, score: 10, volume: 1, velocity: 1 }])
    store.saveTrendPoints([{ trendId: 't1', at: NOW, score: 30, volume: 4, velocity: 3 }])
    expect(store.trendSeries('t1')).toHaveLength(1)
    expect(store.trendSeries('t1')[0]?.score).toBe(30)
  })

  it('ordena tendencias por puntuación y conserva el acuse de recibo', () => {
    const store = new MemoryStore()
    store.putTrends([{ ...trend('lo'), score: 10 }, { ...trend('hi'), score: 90 }])
    expect(store.queryTrends()[0]?.id).toBe('hi')
    store.acknowledgeTrend('hi')
    store.putTrends([{ ...trend('hi'), score: 95 }])
    expect(store.getTrend('hi')?.acknowledged).toBe(true)
  })

  it('aplica retención sin tocar lo reciente', () => {
    const store = new MemoryStore()
    store.putItems([item('viejo', 60 * 24 * 40), item('nuevo', 10)])
    const removed = store.prune(NOW - 30 * 24 * 60 * 60_000)
    expect(removed.items).toBe(1)
    expect(store.itemCount()).toBe(1)
  })

  it('sobrevive a un ciclo de instantánea: nada se pierde', () => {
    const store = new MemoryStore()
    store.putItems([item('a', 5, 'OpenAI anuncia un modelo nuevo')])
    store.putTrends([trend('t1')])
    store.putAlertRules([])
    store.addBookmark('reddit:a')
    store.saveSession({ ...createSessionState(NOW), lang: 'en' })
    store.set('tema', 'dark')

    const revived = new MemoryStore(store.snapshot())
    expect(revived.itemCount()).toBe(1)
    expect(revived.getTrend('t1')?.score).toBe(50)
    expect(revived.isBookmarked('reddit:a')).toBe(true)
    expect(revived.loadSession()?.lang).toBe('en')
    expect(revived.get('tema')).toBe('dark')
    // el índice de búsqueda se reconstruye al hidratar
    expect(revived.searchItems('openai')).toHaveLength(1)
  })

  it('resume el estado para diagnóstico', () => {
    const store = new MemoryStore()
    store.putItems([item('a', 5, 'OpenAI', 'bluesky'), item('b', 6, 'X', 'reddit')])
    const stats = store.stats()
    expect(stats.items).toBe(2)
    expect(stats.sources).toBe(2)
    expect(stats.newestItemAt).toBeGreaterThan(stats.oldestItemAt ?? 0)
  })
})
