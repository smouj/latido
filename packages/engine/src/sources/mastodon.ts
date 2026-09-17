/**
 * Mastodon / Fediverso.
 *
 * Cada instancia es un mundo: el conector se configura con instancias y
 * etiquetas. Las API de Mastodon no mandan CORS en la mayoría de despliegues,
 * así que en el navegador va por el proxy del escritorio.
 */
import type { RawItem } from '../normalize'
import { httpJson } from './http'
import { optionList, optionNumber, type Connector, type FetchContext } from './types'

interface Status {
  id: string
  uri: string
  url: string | null
  created_at: string
  content: string
  language: string | null
  replies_count: number
  reblogs_count: number
  favourites_count: number
  account: { id: string; acct: string; display_name: string; avatar: string; url: string }
  tags?: { name: string }[]
}

export const mastodonConnector: Connector = {
  kind: 'mastodon',
  label: 'Mastodon',
  requiresProxy: true,
  defaultPollMs: 5 * 60 * 1000,
  options: [
    { key: 'instances', label: 'Instancias', placeholder: 'mastodon.social, fosstodon.org', defaultValue: 'mastodon.social' },
    { key: 'tags', label: 'Etiquetas', placeholder: 'tecnologia, rust, ia', defaultValue: '' },
    { key: 'limit', label: 'Máximo por etiqueta', placeholder: '20', defaultValue: '20' },
  ],

  async fetchItems(config, ctx: FetchContext): Promise<RawItem[]> {
    const instances = optionList(config, 'instances', ['mastodon.social']).slice(0, 6)
    const tags = optionList(config, 'tags').slice(0, 8)
    const limit = Math.min(optionNumber(config, 'limit', 20), ctx.limit ?? 20)
    if (tags.length === 0) return []

    const results = await Promise.all(
      instances.flatMap((instance) =>
        tags.map(async (tag) => {
          const url = `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`
          try {
            const statuses = await httpJson<Status[]>(ctx, url, { source: 'mastodon' })
            return statuses.map<RawItem>((status) => ({
              source: 'mastodon',
              externalId: status.uri || status.id,
              url: status.url ?? `https://${instance}/@${status.account.acct}/${status.id}`,
              body: status.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200),
              lang: status.language ?? 'und',
              author: {
                id: `mastodon:${status.account.id}`,
                handle: `@${status.account.acct}`,
                displayName: status.account.display_name || undefined,
                avatarUrl: status.account.avatar,
                url: status.account.url,
              },
              publishedAt: Date.parse(status.created_at) || ctx.now,
              metrics: {
                likes: status.favourites_count,
                replies: status.replies_count,
                reposts: status.reblogs_count,
              },
              tags: ['mastodon', tag.toLowerCase(), instance],
              origin: url,
            }))
          } catch (error) {
            ctx.log?.(`Mastodon ${instance} #${tag}: ${(error as Error).message}`)
            return [] as RawItem[]
          }
        }),
      ),
    )
    return results.flat()
  },
}
