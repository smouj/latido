/**
 * GitHub — proyectos que empiezan a moverse.
 *
 * El valor no está en "los repos más populares" (eso ya lo enseña GitHub), sino
 * en detectar repos recién creados o con subida anormal de estrellas. Se usa la
 * API de búsqueda sin autenticar; con `token` en opciones sube el límite de 10
 * a 30 peticiones por minuto.
 */
import type { RawItem } from '../normalize'
import { httpJson } from './http'
import { optionList, optionNumber, type Connector, type FetchContext } from './types'

interface SearchRepos {
  items?: {
    id: number
    full_name: string
    html_url: string
    description: string | null
    stargazers_count: number
    forks_count: number
    open_issues_count: number
    language: string | null
    created_at: string
    pushed_at: string
    owner: { login: string; avatar_url: string }
    topics?: string[]
  }[]
}

interface Release {
  tag_name: string
  name: string | null
  html_url: string
  published_at: string | null
  body: string | null
  author: { login: string; avatar_url: string }
  prerelease: boolean
}

export const githubConnector: Connector = {
  kind: 'github',
  label: 'GitHub',
  requiresProxy: false,
  defaultPollMs: 8 * 60 * 1000,
  options: [
    { key: 'queries', label: 'Búsquedas', placeholder: 'language:rust, topic:ai', defaultValue: 'stars:>200' },
    { key: 'sinceDays', label: 'Creados en los últimos (días)', placeholder: '7', defaultValue: '7' },
    { key: 'repos', label: 'Repos para vigilar releases', placeholder: 'owner/repo, otro/repo', defaultValue: '' },
    { key: 'limit', label: 'Máximo por ciclo', placeholder: '20', defaultValue: '20' },
    { key: 'token', label: 'Token (opcional)', placeholder: 'ghp_…' },
  ],

  async fetchItems(config, ctx: FetchContext): Promise<RawItem[]> {
    const token = typeof config.options['token'] === 'string' ? config.options['token'] : ''
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {}
    const limit = Math.min(optionNumber(config, 'limit', 20), ctx.limit ?? 20)
    const sinceDays = optionNumber(config, 'sinceDays', 7)
    const since = new Date(ctx.now - sinceDays * 86_400_000).toISOString().slice(0, 10)
    const queries = optionList(config, 'queries', ['stars:>200'])
    const repos = optionList(config, 'repos').slice(0, 12)

    const searchResults = await Promise.all(
      queries.slice(0, 4).map(async (query) => {
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
          `${query} created:>${since}`,
        )}&sort=stars&order=desc&per_page=${limit}`
        try {
          const response = await httpJson<SearchRepos>(ctx, url, { source: 'github', headers })
          return (response.items ?? []).map<RawItem>((repo) => ({
            source: 'github',
            externalId: `repo:${repo.full_name}`,
            url: repo.html_url,
            title: `${repo.full_name} +${repo.stargazers_count} ★`,
            body: repo.description ?? '',
            author: { id: `github:${repo.owner.login}`, handle: repo.owner.login, avatarUrl: repo.owner.avatar_url, url: `https://github.com/${repo.owner.login}` },
            publishedAt: Date.parse(repo.created_at) || ctx.now,
            metrics: { stars: repo.stargazers_count, replies: repo.open_issues_count },
            tags: ['github', 'proyecto', ...(repo.language ? [repo.language.toLowerCase()] : []), ...(repo.topics ?? []).slice(0, 4)],
            origin: url,
          }))
        } catch (error) {
          ctx.log?.(`GitHub "${query}": ${(error as Error).message}`)
          return [] as RawItem[]
        }
      }),
    )

    const releaseResults = await Promise.all(
      repos.map(async (repo) => {
        const url = `https://api.github.com/repos/${repo}/releases?per_page=3`
        try {
          const releases = await httpJson<Release[]>(ctx, url, { source: 'github', headers })
          return releases
            .filter((release) => !release.prerelease)
            .map<RawItem>((release) => ({
              source: 'github',
              externalId: `release:${repo}@${release.tag_name}`,
              url: release.html_url,
              title: `${repo} ${release.tag_name}`,
              body: (release.name ?? release.body ?? '').slice(0, 1200),
              author: { id: `github:${release.author.login}`, handle: release.author.login, avatarUrl: release.author.avatar_url },
              publishedAt: release.published_at ? Date.parse(release.published_at) : ctx.now,
              tags: ['github', 'release', repo.toLowerCase()],
              origin: url,
            }))
        } catch (error) {
          ctx.log?.(`GitHub releases ${repo}: ${(error as Error).message}`)
          return [] as RawItem[]
        }
      }),
    )

    return [...searchResults.flat(), ...releaseResults.flat()]
  },
}
