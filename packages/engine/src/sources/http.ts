/**
 * HTTP con modales: identificarse, respetar 429/Retry-After, reintentar con
 * espera creciente y no colgarse. Los conectores no hablan con `fetch` a pelo.
 */
import { SourceError, hostMatchesDomain } from './types'
import type { SessionProvider } from './types'
import type { SourceKind } from '../types'

export const USER_AGENT = 'Latido/0.1 (+https://github.com/smouj/latido; local-first reader)'
const DEFAULT_TIMEOUT = 12_000
const MAX_RETRIES = 2

export interface HttpOptions {
  source: SourceKind
  accept?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  retries?: number
}

export async function httpText(
  ctx: { fetch: typeof fetch; now: number; session?: SessionProvider },
  url: string,
  options: HttpOptions,
): Promise<string> {
  const retries = options.retries ?? MAX_RETRIES
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT)
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const response = await ctx.fetch(url, {
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? 'application/json, text/xml;q=0.9, */*;q=0.8',
          ...sessionHeaders(ctx, options.source, url),
          ...options.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      })

      if (response.status === 429 || response.status === 503) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0')
        const waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : 800 * (attempt + 1)
        if (attempt < retries) {
          await sleep(waitMs)
          continue
        }
        throw new SourceError(options.source, `límite de peticiones (${response.status})`, response.status)
      }

      if (!response.ok) {
        throw new SourceError(options.source, `HTTP ${response.status} en ${url}`, response.status)
      }

      return await response.text()
    } catch (error) {
      lastError = error
      const isAbort = error instanceof DOMException && error.name === 'AbortError'
      const isSourceError = error instanceof SourceError
      if (isSourceError || isAbort || attempt === retries) break
      await sleep(400 * (attempt + 1))
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  if (lastError instanceof SourceError) throw lastError
  throw new SourceError(options.source, describeError(lastError), undefined)
}

export async function httpJson<T>(
  ctx: { fetch: typeof fetch; now: number; session?: SessionProvider },
  url: string,
  options: HttpOptions,
): Promise<T> {
  const text = await httpText(ctx, url, { ...options, accept: 'application/json' })
  try {
    return JSON.parse(text) as T
  } catch {
    throw new SourceError(options.source, `respuesta no es JSON válido: ${url}`)
  }
}

/**
 * Cabeceras de sesión para una petición concreta.
 *
 * La sesión del navegador solo se añade si el host de la petición está entre los
 * dominios declarados por la fuente. La comprobación se hace **aquí**, en cada
 * petición, y no al construir la sesión: así la cookie de un sitio no puede
 * acabar, por descuido, en una petición a otro.
 */
function sessionHeaders(
  ctx: { session?: SessionProvider },
  source: SourceKind,
  url: string,
): Record<string, string> {
  const session = ctx.session?.sessionFor(source)
  if (!session || session.header.trim() === '') return {}
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return {}
  }
  if (!session.domains.some((domain) => hostMatchesDomain(host, domain))) return {}
  return { cookie: session.header }
}

/** Límite de ritmo por fuente: una petición a la vez, con espacio mínimo. */
export class RateLimiter {
  private last = new Map<string, number>()

  constructor(private readonly intervalMs: number) {}

  /** Espera lo necesario para respetar el ritmo. Devuelve los ms esperados. */
  async take(key: string, now = Date.now()): Promise<number> {
    const previous = this.last.get(key) ?? 0
    const wait = Math.max(0, this.intervalMs - (now - previous))
    if (wait > 0) await sleep(wait)
    this.last.set(key, now + wait)
    return wait
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'tiempo de espera agotado'
    return error.message
  }
  return String(error)
}
