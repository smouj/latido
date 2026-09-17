/**
 * Conector de demostración.
 *
 * Genera un día realista de actividad, **determinista**: con la misma semilla
 * produce exactamente los mismos items. Es lo que permite que la app tenga algo
 * que enseñar sin conexión, que las capturas del README sean reproducibles y
 * que los tests de integración no dependan de la red.
 */
import type { RawItem } from '../normalize'
import type { Connector, FetchContext } from './types'

/** PRNG xorshift32: barato, determinista y suficiente para datos de ejemplo. */
export function seededRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 1_000_000) / 1_000_000
  }
}

interface Story {
  /** Entidad semilla: hace que el clustering las agrupe de verdad. */
  entity: string
  headline: string
  /** Fragmentos en distintos idiomas y registros, como en la vida real. */
  fragments: { source: RawItem['source']; text: string; handle: string }[]
  /** Minutos desde "ahora" en los que empezó a hablarse del tema. */
  startedMinAgo: number
  /** Peso relativo: cuánto crece. > 1 = explosivo. */
  momentum: number
}

export const DEMO_STORIES: Story[] = [
  {
    entity: 'openai',
    headline: 'OpenAI anuncia un modelo nuevo',
    startedMinAgo: 11,
    momentum: 4.6,
    fragments: [
      { source: 'bluesky', text: 'OpenAI acaba de anunciar el nuevo modelo. La latencia es absurda comparada con lo anterior.', handle: '@dani.bsky.social' },
      { source: 'bluesky', text: 'Introducing the new GPT model from OpenAI: faster, cheaper, and with a much larger context window.', handle: '@aileaks.bsky.social' },
      { source: 'hackernews', text: 'OpenAI announces new GPT model with 2M token context', handle: 'tosh' },
      { source: 'hackernews', text: 'Nuevo modelo de OpenAI disponible hoy', handle: 'mvalle' },
      { source: 'reddit', text: 'OpenAI just released the new GPT model — benchmarks inside', handle: 'u/nnthrowaway' },
      { source: 'reddit', text: 'El nuevo modelo de OpenAI, probado en local: esto es lo que cambia', handle: 'u/esp_ai' },
      { source: 'mastodon', text: 'OpenAI hat ein neues Modell veröffentlicht. Die Preise bleiben gleich.', handle: '@techde' },
      { source: 'rss', text: 'OpenAI presenta su nuevo modelo: más contexto, menos coste', handle: 'Medio · portada' },
      { source: 'github', text: 'openai/new-model-benchmarks +1842 ★', handle: 'openai' },
    ],
  },
  {
    entity: 'gtavi',
    headline: 'GTA VI: nuevo material',
    startedMinAgo: 26,
    momentum: 3.1,
    fragments: [
      { source: 'bluesky', text: 'Rockstar ha publicado material nuevo de GTA VI y el mapa parece enorme.', handle: '@lucia.bsky.social' },
      { source: 'bluesky', text: 'GTA VI trailer dropped and it looks unreal', handle: '@gamesfeed.bsky.social' },
      { source: 'reddit', text: 'GTA VI: análisis del nuevo material, frame a frame', handle: 'u/vicecity' },
      { source: 'hackernews', text: 'GTA VI new footage: technical breakdown', handle: 'gamegrass' },
      { source: 'rss', text: 'Rockstar muestra GTA VI por primera vez en meses', handle: 'Medio · videojuegos' },
      { source: 'mastodon', text: 'GTA VI: il nuovo filmato è impressionante', handle: '@giochi' },
    ],
  },
  {
    entity: 'nvidia',
    headline: 'NVIDIA y el precio de la memoria',
    startedMinAgo: 48,
    momentum: 2.2,
    fragments: [
      { source: 'hackernews', text: 'NVIDIA raises prices again, citing memory costs', handle: 'chris11' },
      { source: 'rss', text: 'NVIDIA sube precios: la memoria se ha vuelto el cuello de botella', handle: 'Medio · hardware' },
      { source: 'reddit', text: 'NVIDIA GPU prices are out of control (again)', handle: 'u/pcbuilduk' },
      { source: 'bluesky', text: 'NVIDIA pricing is making local AI hardware impossible', handle: '@mlops.bsky.social' },
    ],
  },
  {
    entity: 'firefox',
    headline: 'Firefox cambia de motor de fuentes',
    startedMinAgo: 74,
    momentum: 1.4,
    fragments: [
      { source: 'reddit', text: 'Firefox ships new font rendering engine, pages feel snappier', handle: 'u/mozfan' },
      { source: 'hackernews', text: 'Firefox replaces its font engine', handle: 'tptacek' },
      { source: 'rss', text: 'Firefox estrena motor de fuentes: menos parpadeo al cargar', handle: 'Medio · desarrollo' },
    ],
  },
  {
    entity: 'rust',
    headline: 'Rust en el kernel, otra vez',
    startedMinAgo: 96,
    momentum: 1.1,
    fragments: [
      { source: 'mastodon', text: 'Rust drivers in the Linux kernel just got a big maintainer update', handle: '@kerneldev' },
      { source: 'github', text: 'rust-lang/rust v1.99.0 released', handle: 'rust-lang' },
      { source: 'hackernews', text: 'Rust in the kernel: status update', handle: 'dochtman' },
    ],
  },
]

export interface DemoOptions {
  seed?: number
  /** Reparto de tiempo: cuántos minutos cubre el ejemplo. */
  horizonMin?: number
}

/** Items de ejemplo normalizables, ordenados del más nuevo al más antiguo. */
export function demoRawItems(now: number, options: DemoOptions = {}): RawItem[] {
  const seed = options.seed ?? 20260917
  const random = seededRandom(seed)
  const items: RawItem[] = []

  for (const story of DEMO_STORIES) {
    for (const fragment of story.fragments) {
      const jitter = Math.floor(random() * Math.max(1, story.startedMinAgo * 0.6))
      const minutesAgo = Math.max(1, Math.round(story.startedMinAgo * 0.4 + jitter))
      const publishedAt = now - minutesAgo * 60_000
      const heat = story.momentum * (1 + random() * 0.35)
      items.push({
        source: fragment.source,
        externalId: `demo:${story.entity}:${fragment.handle}:${minutesAgo}`,
        url: `https://example.invalid/${story.entity}/${minutesAgo}-${Math.floor(random() * 9999)}`,
        title: fragment.source === 'rss' || fragment.source === 'github' ? fragment.text : '',
        body: fragment.text,
        lang: fragment.text.includes(' und ') || fragment.text.includes('Modell') ? 'de' : fragment.text.includes('filmato') ? 'it' : undefined,
        author: {
          handle: fragment.handle,
          displayName: fragment.handle.replace(/^@|^u\//, ''),
        },
        publishedAt,
        metrics: {
          likes: Math.round(heat * (40 + random() * 900)),
          replies: Math.round(heat * (4 + random() * 120)),
          reposts: Math.round(heat * (2 + random() * 60)),
          comments: Math.round(heat * (3 + random() * 90)),
          stars: fragment.source === 'github' ? Math.round(heat * 400) : undefined,
        },
        tags: [fragment.source, story.entity, 'demo'],
        origin: `demo:${story.entity}`,
      })
    }
  }

  return items
    .map((item) => ({ ...item, stable: undefined }))
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
}

export const demoConnector: Connector = {
  kind: 'demo',
  label: 'Ejemplo (sin conexión)',
  requiresProxy: false,
  defaultPollMs: 30 * 60 * 1000,
  options: [{ key: 'seed', label: 'Semilla', placeholder: '20260917', defaultValue: '20260917' }],

  async fetchItems(_config, ctx: FetchContext): Promise<RawItem[]> {
    return demoRawItems(ctx.now)
  },
}
