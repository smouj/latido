/**
 * Sesión del navegador, vista desde el motor.
 *
 * Lo que se comprueba aquí es la parte que puede hacer daño si está mal: que la
 * cabecera `Cookie` salga **solo** hacia los dominios declarados por la fuente y
 * solo cuando hay sesión. El descifrado de las cookies de Chrome vive en el
 * escritorio (Rust) y tiene sus propias pruebas.
 */
import { describe, expect, it } from 'vitest'

import { redditConnector } from '../src/sources/reddit'
import { blueskyConnector } from '../src/sources/bluesky'
import { hostMatchesDomain, type SessionProvider } from '../src/sources/types'
import type { SourceSession } from '../src/sources/types'

const NOW = 1_760_000_000_000

interface Call {
  url: string
  headers: Record<string, string>
}

/** `fetch` de mentira que apunta con qué cabeceras se le ha llamado. */
function captureFetch(body: unknown = { data: { children: [] } }): {
  fetch: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const impl = async (input: unknown, init?: { headers?: Record<string, string> }): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
    calls.push({ url, headers: { ...(init?.headers ?? {}) } })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetch: impl as unknown as typeof fetch, calls }
}

function providerFor(session: SourceSession | null): SessionProvider {
  return { sessionFor: () => session }
}

const REDDIT_SESSION: SourceSession = {
  header: 'reddit_session=abc123; token_v2=xyz',
  domains: ['www.reddit.com', 'oauth.reddit.com', 'reddit.com'],
  origin: 'chrome · Profile 1',
}

describe('sesión del navegador', () => {
  it('empareja dominios como manda la norma', () => {
    expect(hostMatchesDomain('www.reddit.com', 'reddit.com')).toBe(true)
    expect(hostMatchesDomain('reddit.com', 'reddit.com')).toBe(true)
    expect(hostMatchesDomain('www.reddit.com', '.reddit.com')).toBe(true)
    expect(hostMatchesDomain('notreddit.com', 'reddit.com')).toBe(false)
    expect(hostMatchesDomain('reddit.com.evil.test', 'reddit.com')).toBe(false)
    expect(hostMatchesDomain('', 'reddit.com')).toBe(false)
  })

  it('manda la cabecera cuando la hay y el dominio coincide', async () => {
    const { fetch, calls } = captureFetch()
    await redditConnector.fetchItems(
      { kind: 'reddit', enabled: true, options: { subreddits: 'technology', limit: 5 } },
      { fetch, now: NOW, session: providerFor(REDDIT_SESSION) },
    )
    expect(calls.length).toBe(1)
    expect(calls[0]?.headers['cookie']).toBe(REDDIT_SESSION.header)
  })

  it('no manda nada cuando no hay sesión', async () => {
    const { fetch, calls } = captureFetch()
    await redditConnector.fetchItems(
      { kind: 'reddit', enabled: true, options: { subreddits: 'technology', limit: 5 } },
      { fetch, now: NOW, session: providerFor(null) },
    )
    expect(calls[0]?.headers['cookie']).toBeUndefined()
  })

  it('no manda la sesión a un dominio que no es suyo', async () => {
    const { fetch, calls } = captureFetch()
    await redditConnector.fetchItems(
      { kind: 'reddit', enabled: true, options: { subreddits: 'technology', limit: 5 } },
      {
        fetch,
        now: NOW,
        // La sesión existe, pero es de otro sitio: no debe viajar.
        session: providerFor({ ...REDDIT_SESSION, domains: ['public.api.bsky.app'] }),
      },
    )
    expect(calls[0]?.headers['cookie']).toBeUndefined()
  })

  it('sin proveedor de sesión todo sigue igual que antes', async () => {
    const { fetch, calls } = captureFetch()
    await redditConnector.fetchItems(
      { kind: 'reddit', enabled: true, options: { subreddits: 'technology', limit: 5 } },
      { fetch, now: NOW },
    )
    expect(calls[0]?.headers['cookie']).toBeUndefined()
  })

  it('una cabecera vacía no se manda', async () => {
    const { fetch, calls } = captureFetch()
    await redditConnector.fetchItems(
      { kind: 'reddit', enabled: true, options: { subreddits: 'technology', limit: 5 } },
      { fetch, now: NOW, session: providerFor({ ...REDDIT_SESSION, header: '   ' }) },
    )
    expect(calls[0]?.headers['cookie']).toBeUndefined()
  })

  it('las fuentes declaran qué dominios necesitan', () => {
    expect(redditConnector.session?.domains).toContain('www.reddit.com')
    expect(redditConnector.session?.key).toBe('reddit')
    // Bluesky se declara, pero su AppView no se autentica con cookies: la
    // etiqueta lo dice para que la interfaz no prometa de más.
    expect(blueskyConnector.session?.domains).toContain('public.api.bsky.app')
    expect(blueskyConnector.session?.label).toContain('token')
  })

  it('la sesión viaja al host correcto del conector de Bluesky', async () => {
    const { fetch, calls } = captureFetch({ posts: [] })
    await blueskyConnector.fetchItems(
      { kind: 'bluesky', enabled: true, options: { queries: 'rust', limit: 5 } },
      {
        fetch,
        now: NOW,
        session: providerFor({
          header: 'bsky=1',
          domains: ['public.api.bsky.app'],
          origin: 'chrome · Default',
        }),
      },
    )
    expect(calls[0]?.url).toContain('public.api.bsky.app')
    expect(calls[0]?.headers['cookie']).toBe('bsky=1')
  })
})
