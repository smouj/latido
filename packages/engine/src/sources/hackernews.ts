/**
 * Hacker News — API oficial de Firebase.
 * Sin clave, sin cuota declarada y con CORS abierto: el conector más fiable
 * para el arranque, y por eso es el que viene activado de fábrica.
 * https://github.com/HackerNews/API
 */
import type { RawItem } from '../normalize'
import { httpJson } from './http'
import { optionList, optionNumber, type Connector, type FetchContext } from './types'

interface HnItem {
  id: number
  type?: string
  by?: string
  time?: number
  title?: string
  text?: string
  url?: string
  score?: number
  descendants?: number
  deleted?: boolean
  dead?: boolean
}

const BASE = 'https://hacker-news.firebaseio.com/v0'

export const hackerNewsConnector: Connector = {
  kind: 'hackernews',
  label: 'Hacker News',
  requiresProxy: false,
  defaultPollMs: 3 * 60 * 1000,
  options: [
    { key: 'lists', label: 'Listas', placeholder: 'topstories,newstories,beststories', defaultValue: 'topstories,beststories' },
    { key: 'limit', label: 'Máximo por ciclo', placeholder: '30', defaultValue: '30' },
  ],

  async fetchItems(config, ctx: FetchContext): Promise<RawItem[]> {
    const lists = optionList(config, 'lists', ['topstories', 'beststories'])
    const limit = Math.min(optionNumber(config, 'limit', 30), ctx.limit ?? 30)

    const idGroups = await Promise.all(
      lists.map((list) =>
        httpJson<number[]>(ctx, `${BASE}/${list}.json`, { source: 'hackernews' }).catch(() => [] as number[]),
      ),
    )

    const ids: number[] = []
    for (const group of idGroups) {
      for (const id of group.slice(0, limit)) if (!ids.includes(id)) ids.push(id)
      if (ids.length >= limit) break
    }

    const selected = ids.slice(0, limit)
    const items = await mapWithConcurrency(selected, 6, async (id) => {
      try {
        return await httpJson<HnItem>(ctx, `${BASE}/item/${id}.json`, { source: 'hackernews' })
      } catch {
        return null
      }
    })

    return items
      .filter((item): item is HnItem => Boolean(item) && !item?.deleted && !item?.dead)
      .filter((item) => item.type === 'story' || item.type === 'job')
      .map<RawItem>((item) => ({
        source: 'hackernews',
        externalId: String(item.id),
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        title: item.title ?? '',
        body: stripHtml(item.text ?? ''),
        author: { handle: item.by ?? 'anónimo', url: `https://news.ycombinator.com/user?id=${item.by ?? ''}` },
        publishedAt: (item.time ?? 0) * 1000,
        metrics: { score: item.score ?? 0, comments: item.descendants ?? 0 },
        tags: ['hackernews'],
        origin: `${BASE}/item/${item.id}.json`,
      }))
  },
}

/** HN devuelve HTML en los comentarios: se limpia sin dependencias. */
export function stripHtml(input: string): string {
  return input
    .replace(/<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** Concurrencia acotada: no abrimos 500 conexiones por un ciclo. */
export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      const value = values[index]
      if (value === undefined) continue
      results[index] = await worker(value, index)
    }
  })
  await Promise.all(runners)
  return results
}
