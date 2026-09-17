/**
 * Registro de conectores. Añadir una red = añadir un archivo y una línea aquí;
 * ni el motor ni la interfaz cambian.
 */
import { blueskyConnector } from './bluesky'
import { demoConnector } from './demo'
import { githubConnector } from './github'
import { hackerNewsConnector } from './hackernews'
import { mastodonConnector } from './mastodon'
import { redditConnector } from './reddit'
import { rssConnector } from './rss'
import type { Connector } from './types'
import type { SourceConfig, SourceKind } from '../types'

export const CONNECTORS: Record<SourceKind, Connector> = {
  bluesky: blueskyConnector,
  hackernews: hackerNewsConnector,
  reddit: redditConnector,
  mastodon: mastodonConnector,
  rss: rssConnector,
  github: githubConnector,
  demo: demoConnector,
  // Todavía sin conector propio: se anuncian en la carretera, no en la interfaz.
  youtube: demoConnector,
  lemmy: demoConnector,
}

/** Configuración inicial: lo que funciona sin clave y sin fricción. */
export function defaultSourceConfigs(): SourceConfig[] {
  return [
    { kind: 'hackernews', enabled: true, options: { lists: 'topstories,beststories', limit: 30 } },
    { kind: 'bluesky', enabled: true, options: { queries: '', limit: 25 } },
    { kind: 'github', enabled: true, options: { queries: 'stars:>150', sinceDays: 7, repos: '', limit: 15 } },
    { kind: 'reddit', enabled: false, requiresProxy: true, options: { subreddits: 'technology,programming', sort: 'new', limit: 25 } },
    { kind: 'mastodon', enabled: false, requiresProxy: true, options: { instances: 'mastodon.social', tags: '', limit: 20 } },
    { kind: 'rss', enabled: false, requiresProxy: true, options: { feeds: '' } },
    { kind: 'demo', enabled: false, options: { seed: 20260917 } },
  ]
}

export { blueskyConnector, demoConnector, githubConnector, hackerNewsConnector, mastodonConnector, redditConnector, rssConnector }
export type { Connector, FetchContext } from './types'
export { parseFeed } from './rss'
export { stripHtml, mapWithConcurrency } from './hackernews'
export { demoRawItems, DEMO_STORIES, seededRandom } from './demo'
export { BlueskyStream } from './bluesky'
export { RateLimiter, httpJson, httpText, USER_AGENT } from './http'
