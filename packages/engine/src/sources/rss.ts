/**
 * RSS / Atom — la fuente más flexible y la que menos depende de terceros.
 * Un usuario puede apuntar a un blog, a un medio o al feed de releases de un
 * proyecto y Latido lo trata igual que a una red social.
 */
import { XMLParser } from 'fast-xml-parser'

import type { RawItem } from '../normalize'
import { httpText } from './http'
import { optionList, type Connector, type FetchContext } from './types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
})

interface FeedNode {
  title?: string | Record<string, unknown>
  link?: string | Record<string, unknown> | (string | Record<string, unknown>)[]
  description?: string
  summary?: string
  content?: string | Record<string, unknown>
  'content:encoded'?: string
  pubDate?: string
  published?: string
  updated?: string
  id?: string
  guid?: string | Record<string, unknown>
  author?: string | Record<string, unknown>
  'dc:creator'?: string
  category?: string | string[] | Record<string, unknown>[]
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return textOf(record['#text'] ?? record['@_href'] ?? record['@_url'] ?? '')
  }
  return ''
}

function linkOf(node: FeedNode): string {
  const candidates = Array.isArray(node.link) ? node.link : [node.link]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>
      const href = record['@_href']
      const rel = record['@_rel']
      if (typeof href === 'string' && (rel === undefined || rel === 'alternate')) return href
    }
  }
  return textOf(node.id) || textOf(node.guid)
}

function dateOf(node: FeedNode, now: number): number {
  const raw = node.pubDate ?? node.published ?? node.updated
  if (!raw) return now
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : now
}

function categoriesOf(node: FeedNode): string[] {
  const raw = node.category
  if (!raw) return []
  const values = Array.isArray(raw) ? raw : [raw]
  return values.map((value) => textOf(value)).filter(Boolean)
}

/** Extrae items de un feed ya descargado. Exportado para poder testearlo. */
export function parseFeed(xml: string, feedUrl: string, now: number, limit = 25): RawItem[] {
  const document = parser.parse(xml) as Record<string, unknown>
  const rss = document['rss'] as Record<string, unknown> | undefined
  const channel = (rss?.['channel'] ?? document['channel']) as Record<string, unknown> | undefined
  const atomFeed = document['feed'] as Record<string, unknown> | undefined

  const rawEntries: unknown[] = []
  if (channel?.['item']) rawEntries.push(...toArray(channel['item']))
  if (atomFeed?.['entry']) rawEntries.push(...toArray(atomFeed['entry']))

  const feedTitle = textOf(channel?.['title'] ?? atomFeed?.['title']) || new URL(feedUrl).hostname

  return rawEntries.slice(0, limit).map<RawItem>((entry) => {
    const node = entry as FeedNode
    const url = linkOf(node)
    const body = textOf(node['content:encoded'] ?? node.content ?? node.description ?? node.summary)
    const html = body.replace(/<[^>]+>/g, ' ')
    return {
      source: 'rss',
      externalId: url || `${feedUrl}#${textOf(node.title)}`,
      url: url || feedUrl,
      title: textOf(node.title),
      body: html.replace(/\s+/g, ' ').trim().slice(0, 2000),
      author: { handle: textOf(node['dc:creator'] ?? node.author) || new URL(feedUrl).hostname },
      publishedAt: dateOf(node, now),
      tags: ['rss', ...categoriesOf(node).map((category) => category.toLowerCase())],
      origin: `${feedTitle} · ${feedUrl}`,
    }
  }).filter((item) => item.url.length > 0)
}

export function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

export const rssConnector: Connector = {
  kind: 'rss',
  label: 'RSS / Atom',
  requiresProxy: true, // casi ningún medio manda cabeceras CORS
  defaultPollMs: 10 * 60 * 1000,
  options: [
    {
      key: 'feeds',
      label: 'Feeds',
      placeholder: 'https://example.com/feed.xml, https://blog.dev/rss',
      defaultValue: '',
    },
  ],

  async fetchItems(config, ctx: FetchContext): Promise<RawItem[]> {
    const feeds = optionList(config, 'feeds').slice(0, 24)
    const results = await Promise.all(
      feeds.map(async (feed) => {
        try {
          const xml = await httpText(ctx, feed, { source: 'rss', accept: 'application/rss+xml, application/xml, text/xml' })
          return parseFeed(xml, feed, ctx.now, ctx.limit ?? 20)
        } catch (error) {
          ctx.log?.(`RSS ${feed}: ${(error as Error).message}`)
          return [] as RawItem[]
        }
      }),
    )
    return results.flat()
  },
}
