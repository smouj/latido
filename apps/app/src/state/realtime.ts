/**
 * Tiempo real.
 *
 * Hacker News, Reddit, Mastodon y RSS se **sondean**: son API de consulta y no
 * ofrecen otra cosa. Bluesky sí tiene un flujo abierto —Jetstream— y aquí se
 * aprovecha: los items entran según se publican, no cuando toca el turno.
 *
 * Regla de rendimiento: **nada de pintar por item**. Los items se acumulan en un
 * búfer y se ingieren en tandas; el recálculo de tendencias va más despacio
 * todavía, porque ordenar sesenta temas cuesta más que normalizar un item. Con
 * eso, un pico de actividad no bloquea la interfaz.
 *
 * Solo se conecta si hay de qué filtrar: el flujo completo de Bluesky son miles
 * de publicaciones por segundo y tirarlo entero contra la app no tiene sentido.
 */
import { BlueskyStream, type RawItem, type SourceKind } from '@latido/engine'

export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'error'

export interface RealtimeOptions {
  /** Términos que deben aparecer en el texto. Sin ellos no se conecta. */
  keywords: string[]
  /** Idiomas aceptados (`es`, `en`…). Vacío = todos. */
  langs?: string[]
  fetchImpl: typeof fetch
  /** Se llama con cada tanda ya acumulada. */
  onBatch: (items: RawItem[]) => void
  onStatus: (status: RealtimeStatus, detail?: string) => void
}

const FLUSH_MS = 3000
const MAX_BUFFER = 400

let stream: BlueskyStream | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null
let buffer: RawItem[] = []
let dropped = 0

export function isRunning(): boolean {
  return stream !== null
}

/** Arranca el flujo. Devuelve `false` si no hay nada con lo que filtrar. */
export function startRealtime(options: RealtimeOptions): boolean {
  const keywords = options.keywords.map((keyword) => keyword.trim().toLowerCase()).filter((keyword) => keyword.length >= 3)
  if (keywords.length === 0) {
    options.onStatus('off', 'sin términos que vigilar')
    return false
  }

  stopRealtime()
  buffer = []
  dropped = 0

  stream = new BlueskyStream(
    { fetch: options.fetchImpl, now: Date.now() },
    {
      onItem: (item) => {
        buffer.push(item)
        // Si alguien publica más rápido de lo que podemos digerir, tiramos lo más
        // viejo: es un flujo, no un archivo; perder un item no rompe nada.
        if (buffer.length > MAX_BUFFER) {
          dropped += buffer.length - MAX_BUFFER
          buffer = buffer.slice(-MAX_BUFFER)
        }
      },
      onStatus: (status, detail) => {
        if (status === 'closed') options.onStatus('off', detail)
        else if (status === 'live') options.onStatus('live', detail)
        else if (status === 'connecting') options.onStatus('connecting', detail)
        else options.onStatus('reconnecting', detail)
      },
      onError: (error) => options.onStatus('error', error.message),
    },
    {
      keywords,
      collections: ['app.bsky.feed.post'],
      ...(options.langs && options.langs.length > 0 ? { langs: options.langs } : {}),
    },
  )

  stream.start()

  flushTimer = setInterval(() => {
    if (buffer.length === 0) return
    const batch = buffer.splice(0, buffer.length)
    dropped = 0
    options.onBatch(batch)
  }, FLUSH_MS)

  options.onStatus('connecting')
  return true
}

export function stopRealtime(): void {
  if (flushTimer) clearInterval(flushTimer)
  flushTimer = null
  stream?.stop()
  stream = null
  buffer = []
}

/** Cuántos items se han descartado por saturación desde el último vaciado. */
export function droppedCount(): number {
  return dropped
}

/** Términos con los que filtrar: búsquedas configuradas + intereses del usuario. */
export function keywordsFrom(options: {
  queries: string[]
  watchlist: string[]
  entities: { slug: string; name: string; watch: boolean }[]
}): string[] {
  const words = new Set<string>()
  for (const query of options.queries) {
    for (const part of query.split(',')) {
      const clean = part.trim().toLowerCase()
      if (clean.length >= 3) words.add(clean)
    }
  }
  for (const slug of options.watchlist) if (slug.length >= 3) words.add(slug.replace(/-/g, ' '))
  for (const entity of options.entities) {
    if (!entity.watch) continue
    words.add(entity.name.toLowerCase())
    words.add(entity.slug.replace(/-/g, ' '))
  }
  return [...words].slice(0, 40)
}

/** Fuentes que pueden estar en tiempo real hoy. Las demás se sondean. */
export const REALTIME_SOURCES: SourceKind[] = ['bluesky']
