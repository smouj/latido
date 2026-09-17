/**
 * Reddit.
 *
 * Se usa el endpoint público `/<sub>/new.json`, que es el que permiten sus
 * condiciones para lectura ligera y sin clave. Reddit **exige** identificarse
 * con un User-Agent propio y limita el ritmo: por eso `pollMs` es alto y todo
 * pasa por el limitador.
 *
 * Reddit no manda cabeceras CORS, así que en el navegador va por el proxy del
 * escritorio (`requiresProxy: true`). Con `clientId`/`refreshToken` en las
 * opciones se usa OAuth y el límite sube, sin cambiar nada más.
 */
import type { RawItem } from '../normalize'
import { httpJson } from './http'
import { optionList, optionNumber, type Connector, type FetchContext } from './types'

interface Listing {
  data?: {
    children?: {
      data?: {
        id: string
        name?: string
        title?: string
        selftext?: string
        permalink?: string
        url?: string
        author?: string
        created_utc?: number
        ups?: number
        num_comments?: number
        subreddit?: string
        link_flair_text?: string | null
        over_18?: boolean
      }
    }[]
  }
}

export const redditConnector: Connector = {
  kind: 'reddit',
  label: 'Reddit',
  requiresProxy: true,
  defaultPollMs: 5 * 60 * 1000,
  // Reddit responde 403 a quien no lleva sesión. Con la sesión del navegador se
  // lee la misma cuenta que el usuario ya tiene abierta, sin pedir nada nuevo.
  session: {
    key: 'reddit',
    domains: ['www.reddit.com', 'oauth.reddit.com', 'reddit.com'],
    label: 'Reddit responde 403 sin sesión: con la tuya se lee el feed real.',
  },
  options: [
    { key: 'subreddits', label: 'Subreddits', placeholder: 'technology, programming, Games', defaultValue: 'technology,programming' },
    { key: 'sort', label: 'Orden', placeholder: 'new', defaultValue: 'new' },
    { key: 'limit', label: 'Máximo por subreddit', placeholder: '25', defaultValue: '25' },
    { key: 'token', label: 'Token OAuth (opcional)', placeholder: 'opcional' },
  ],

  async fetchItems(config, ctx: FetchContext): Promise<RawItem[]> {
    const subreddits = optionList(config, 'subreddits').slice(0, 12)
    const sort = String(config.options['sort'] ?? 'new')
    const limit = Math.min(optionNumber(config, 'limit', 25), ctx.limit ?? 25)
    const token = typeof config.options['token'] === 'string' ? config.options['token'] : ''
    const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com'

    const results = await Promise.all(
      subreddits.map(async (subreddit) => {
        const url = `${base}/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}&raw_json=1`
        try {
          const listing = await httpJson<Listing>(ctx, url, {
            source: 'reddit',
            headers: token ? { authorization: `Bearer ${token}` } : {},
          })
          return (listing.data?.children ?? []).flatMap((child) => {
            const post = child.data
            if (!post || post.over_18) return []
            return [
              {
                source: 'reddit' as const,
                externalId: post.name ?? `t3_${post.id}`,
                url: post.permalink ? `https://www.reddit.com${post.permalink}` : (post.url ?? ''),
                title: post.title ?? '',
                body: (post.selftext ?? '').slice(0, 1500),
                author: { handle: post.author ? `u/${post.author}` : 'u/anónimo', url: post.author ? `https://www.reddit.com/user/${post.author}` : undefined },
                publishedAt: (post.created_utc ?? 0) * 1000,
                metrics: { likes: post.ups ?? 0, comments: post.num_comments ?? 0 },
                tags: ['reddit', ...(post.subreddit ? [post.subreddit.toLowerCase()] : []), ...(post.link_flair_text ? [post.link_flair_text.toLowerCase()] : [])],
                origin: url,
              },
            ]
          })
        } catch (error) {
          ctx.log?.(`Reddit r/${subreddit}: ${(error as Error).message}`)
          return [] as RawItem[]
        }
      }),
    )
    return results.flat()
  },
}
