/**
 * Bluesky / AT Protocol.
 *
 * Dos caminos, igual que en el diseño:
 *  - `fetchItems`: búsqueda pública (XRPC) para llenar el feed al arrancar.
 *  - `BlueskyStream`: Jetstream, el flujo en tiempo real del protocolo. Es la
 *    pieza que hace que Latido se entere de algo *mientras* pasa.
 *
 * Jetstream manda DIDs, no nombres: se resuelven aparte y se cachean, para no
 * pedir el mismo perfil dos veces.
 */
import type { RawItem } from '../normalize'
import { httpJson } from './http'
import { optionList, optionNumber, type Connector, type FetchContext } from './types'

const PUBLIC_API = 'https://public.api.bsky.app/xrpc'
const JETSTREAM = 'wss://jetstream2.us-east.bsky.network/subscribe'

interface SearchPostView {
  uri: string
  cid: string
  author: { did: string; handle: string; displayName?: string; avatar?: string }
  record: { text?: string; createdAt?: string; langs?: string[] }
  indexedAt?: string
  likeCount?: number
  replyCount?: number
  repostCount?: number
  quoteCount?: number
}

interface SearchResponse {
  posts?: SearchPostView[]
}

export const blueskyConnector: Connector = {
  kind: 'bluesky',
  label: 'Bluesky',
  requiresProxy: false,
  defaultPollMs: 2 * 60 * 1000,
  options: [
    { key: 'queries', label: 'Búsquedas', placeholder: 'openai, gta vi, rust lang', defaultValue: '' },
    { key: 'limit', label: 'Máximo por ciclo', placeholder: '25', defaultValue: '25' },
  ],

  async fetchItems(config, ctx: FetchContext): Promise<RawItem[]> {
    const queries = optionList(config, 'queries').slice(0, 8)
    const limit = Math.min(optionNumber(config, 'limit', 25), ctx.limit ?? 25)
    if (queries.length === 0) return []

    const results = await Promise.all(
      queries.map(async (query) => {
        const url = `${PUBLIC_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&sort=latest&limit=${limit}`
        try {
          const response = await httpJson<SearchResponse>(ctx, url, { source: 'bluesky' })
          return (response.posts ?? []).map((post) => searchPostToRaw(post))
        } catch (error) {
          ctx.log?.(`Bluesky "${query}": ${(error as Error).message}`)
          return [] as RawItem[]
        }
      }),
    )
    return results.flat()
  },
}

export function searchPostToRaw(post: SearchPostView): RawItem {
  const rkey = post.uri.split('/').pop() ?? post.cid
  const handle = post.author.handle || post.author.did
  return {
    source: 'bluesky',
    externalId: post.uri,
    url: `https://bsky.app/profile/${handle}/post/${rkey}`,
    title: '',
    body: (post.record.text ?? '').slice(0, 1000),
    lang: post.record.langs?.[0] ?? 'und',
    author: {
      id: post.author.did,
      handle,
      ...(post.author.displayName ? { displayName: post.author.displayName } : {}),
      ...(post.author.avatar ? { avatarUrl: post.author.avatar } : {}),
      url: `https://bsky.app/profile/${handle}`,
    },
    publishedAt: post.record.createdAt ? Date.parse(post.record.createdAt) : Date.now(),
    metrics: {
      likes: post.likeCount ?? 0,
      replies: post.replyCount ?? 0,
      reposts: post.repostCount ?? 0,
    },
    tags: ['bluesky'],
    origin: `app.bsky.feed.searchPosts:${post.uri}`,
  }
}

interface JetstreamEvent {
  did: string
  time_us: number
  kind: 'commit' | 'identity' | 'account' | string
  commit?: {
    rev?: string
    operation?: string
    collection?: string
    rkey?: string
    record?: { text?: string; langs?: string[]; createdAt?: string; reply?: unknown }
  }
}

export interface StreamHandlers {
  onItem: (item: RawItem) => void | Promise<void>
  onStatus?: (status: 'connecting' | 'live' | 'reconnecting' | 'closed', detail?: string) => void
  onError?: (error: Error) => void
}

export interface StreamOptions {
  /** Solo estos idiomas. Vacío = todos. */
  langs?: string[]
  /** Si se indica, solo pasan textos que contengan alguno de estos términos. */
  keywords?: string[]
  /** Colecciones de AT Protocol a escuchar. */
  collections?: string[]
  /** Backoff máximo entre reconexiones. */
  maxBackoffMs?: number
}

/**
 * Cliente de Jetstream con reconexión exponencial.
 *
 * Se detiene con `stop()` y nunca lanza: un corte de red se reintenta. Es
 * deliberadamente aburrido, porque va a estar corriendo durante horas.
 */
export class BlueskyStream {
  private socket: WebSocket | null = null
  private stopped = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly handles = new Map<string, string>()

  constructor(
    private readonly ctx: { fetch: typeof fetch; now: number },
    private readonly handlers: StreamHandlers,
    private readonly options: StreamOptions = {},
  ) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.socket?.close()
    this.socket = null
    this.handlers.onStatus?.('closed')
  }

  get connected(): boolean {
    return this.socket?.readyState === 1
  }

  private connect(): void {
    const collections = this.options.collections ?? ['app.bsky.feed.post']
    const params = collections.map((collection) => `wantedCollections=${encodeURIComponent(collection)}`).join('&')
    const url = `${JETSTREAM}?${params}`

    try {
      this.handlers.onStatus?.(this.attempt === 0 ? 'connecting' : 'reconnecting')
      const socket = new WebSocket(url)
      this.socket = socket

      socket.onopen = () => {
        this.attempt = 0
        this.handlers.onStatus?.('live')
      }

      socket.onmessage = (event) => {
        void this.handleMessage(typeof event.data === 'string' ? event.data : '')
      }

      socket.onerror = () => {
        this.handlers.onError?.(new Error('Jetstream: error de socket'))
      }

      socket.onclose = () => {
        if (this.stopped) return
        this.scheduleReconnect()
      }
    } catch (error) {
      this.handlers.onError?.(error as Error)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.attempt = Math.min(this.attempt + 1, 6)
    const backoff = Math.min(1000 * 2 ** this.attempt, this.options.maxBackoffMs ?? 60_000)
    this.handlers.onStatus?.('reconnecting', `nuevo intento en ${Math.round(backoff / 1000)} s`)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), backoff)
  }

  private async handleMessage(data: string): Promise<void> {
    if (data.length === 0) return
    let event: JetstreamEvent
    try {
      event = JSON.parse(data) as JetstreamEvent
    } catch {
      return
    }
    if (event.kind !== 'commit' || event.commit?.operation !== 'create') return
    const record = event.commit.record
    const text = record?.text ?? ''
    if (text.trim().length < 12) return

    if (this.options.langs && this.options.langs.length > 0) {
      const langs = record?.langs ?? []
      if (langs.length > 0 && !langs.some((lang) => this.options.langs?.includes(lang.split('-')[0] ?? lang))) {
        return
      }
    }

    if (this.options.keywords && this.options.keywords.length > 0) {
      const haystack = text.toLowerCase()
      if (!this.options.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) return
    }

    const handle = await this.resolveHandle(event.did)
    const rkey = event.commit.rkey ?? ''
    const raw: RawItem = {
      source: 'bluesky',
      externalId: `at://${event.did}/app.bsky.feed.post/${rkey}`,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      body: text.slice(0, 1000),
      lang: record?.langs?.[0] ?? 'und',
      author: { id: event.did, handle, url: `https://bsky.app/profile/${handle}` },
      publishedAt: record?.createdAt ? Date.parse(record.createdAt) : Math.round(event.time_us / 1000),
      tags: ['bluesky', 'tiempo-real'],
      origin: 'jetstream',
    }
    await this.handlers.onItem(raw)
  }

  /** DID → handle, cacheado en memoria. Si falla, se queda con el DID. */
  private async resolveHandle(did: string): Promise<string> {
    const cached = this.handles.get(did)
    if (cached) return cached
    try {
      const profile = await httpJson<{ handle?: string }>(
        this.ctx,
        `${PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
        { source: 'bluesky', retries: 0, timeoutMs: 6000 },
      )
      const handle = profile.handle ?? did
      this.handles.set(did, handle)
      return handle
    } catch {
      return did
    }
  }
}
