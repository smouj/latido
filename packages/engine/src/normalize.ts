/**
 * Normalización: la frontera entre "lo que devuelve una red" y el modelo
 * canónico. Cada conector entrega datos sucios; aquí se convierten en `Item`
 * y se les extraen entidades.
 */
import { fnv1a64, normalizeText, simhash, slugify, tokenize } from './text'
import type { Author, Item, ItemMetrics, SourceKind } from './types'

/** Entidades conocidas: semilla del diccionario que el usuario puede ampliar. */
export const ENTITY_SEED: Record<string, { name: string; kind: 'person' | 'org' | 'project' | 'topic' | 'place'; aliases: string[] }> = {
  openai: { name: 'OpenAI', kind: 'org', aliases: ['openai', 'chatgpt', 'gpt'] },
  anthropic: { name: 'Anthropic', kind: 'org', aliases: ['anthropic', 'claude'] },
  google: { name: 'Google', kind: 'org', aliases: ['google', 'deepmind', 'gemini'] },
  meta: { name: 'Meta', kind: 'org', aliases: ['meta', 'llama'] },
  microsoft: { name: 'Microsoft', kind: 'org', aliases: ['microsoft', 'copilot'] },
  nvidia: { name: 'NVIDIA', kind: 'org', aliases: ['nvidia', 'cuda'] },
  apple: { name: 'Apple', kind: 'org', aliases: ['apple', 'ios', 'macos'] },
  rockstar: { name: 'Rockstar', kind: 'org', aliases: ['rockstar'] },
  gtavi: { name: 'GTA VI', kind: 'project', aliases: ['gta vi', 'gta 6', 'gtavi'] },
  linux: { name: 'Linux', kind: 'project', aliases: ['linux', 'kernel'] },
  rust: { name: 'Rust', kind: 'project', aliases: ['rust', 'rustlang', 'cargo'] },
  python: { name: 'Python', kind: 'project', aliases: ['python', 'pypi'] },
  typescript: { name: 'TypeScript', kind: 'project', aliases: ['typescript', 'tsc'] },
  firefox: { name: 'Firefox', kind: 'project', aliases: ['firefox'] },
  android: { name: 'Android', kind: 'project', aliases: ['android'] },
  bluesky: { name: 'Bluesky', kind: 'project', aliases: ['bluesky', 'atproto'] },
  mastodon: { name: 'Mastodon', kind: 'project', aliases: ['mastodon', 'fediverso', 'fediverse'] },
  'hacker-news': { name: 'Hacker News', kind: 'project', aliases: ['hacker news', 'hackernews'] },
  reddit: { name: 'Reddit', kind: 'project', aliases: ['reddit'] },
  github: { name: 'GitHub', kind: 'project', aliases: ['github'] },
  karpathy: { name: 'Andrej Karpathy', kind: 'person', aliases: ['karpathy'] },
  'sam-altman': { name: 'Sam Altman', kind: 'person', aliases: ['sam altman', 'sama'] },
}

export interface RawItem {
  source: SourceKind
  externalId: string
  url: string
  title?: string
  body?: string
  lang?: string
  author?: Partial<Author> & { handle?: string }
  publishedAt?: number
  metrics?: ItemMetrics
  tags?: string[]
  origin: string
}

function stableId(source: SourceKind, url: string, externalId?: string): string {
  const base = externalId && externalId.length > 0 ? externalId : fnv1a64(url).toString(16)
  return `${source}:${base}`
}

/**
 * Detecta entidades del diccionario dentro del texto. Búsqueda por alias con
 * límites de palabra: `gpt` no debe activarse dentro de `gptv`.
 */
export function extractEntities(text: string, dictionary = ENTITY_SEED): string[] {
  const haystack = ` ${normalizeText(text)} `
  const found = new Set<string>()
  for (const [slug, entry] of Object.entries(dictionary)) {
    for (const alias of entry.aliases) {
      const needle = ` ${normalizeText(alias)} `
      if (haystack.includes(needle)) {
        found.add(slug)
        break
      }
    }
  }
  return [...found].sort()
}

export function normalizeAuthor(source: SourceKind, raw: RawItem['author']): Author {
  const handle = (raw?.handle ?? 'desconocido').replace(/^@/, '')
  return {
    id: raw?.id ?? `${source}:${slugify(handle) || 'desconocido'}`,
    handle,
    ...(raw?.displayName ? { displayName: raw.displayName } : {}),
    ...(raw?.avatarUrl ? { avatarUrl: raw.avatarUrl } : {}),
    source,
    ...(raw?.url ? { url: raw.url } : {}),
  }
}

/** Idioma aproximado por marcas frecuentes. Suficiente para filtrar y mostrar. */
export function detectLanguage(text: string): string {
  const sample = ` ${normalizeText(text)} `
  const spanish = [' que ', ' de ', ' la ', ' el ', ' los ', ' para ', ' con ', ' una ', ' está ', ' pero ', ' porque ']
  const english = [' the ', ' and ', ' for ', ' with ', ' that ', ' this ', ' from ', ' have ', ' will ', ' are ']
  let es = 0
  let en = 0
  for (const marker of spanish) if (sample.includes(marker)) es += 1
  for (const marker of english) if (sample.includes(marker)) en += 1
  if (es === 0 && en === 0) return 'und'
  return es >= en ? 'es' : 'en'
}

/** Canoniza una URL: quita parámetros de seguimiento y normaliza el host. */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase()
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|ref|ref_src|fbclid|gclid|igshid|mc_cid|mc_eid|_hs)/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    const query = parsed.searchParams.toString()
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname.replace(/\/$/, '')}${query ? `?${query}` : ''}`
  } catch {
    return url.trim()
  }
}

/**
 * Convierte un `RawItem` en `Item`. No toca la red ni la base de datos: es una
 * función pura, y por eso se puede probar con un solo `expect`.
 */
export function normalizeItem(raw: RawItem, now = Date.now(), dictionary = ENTITY_SEED): Item {
  const url = canonicalUrl(raw.url)
  const title = (raw.title ?? '').trim()
  const body = (raw.body ?? '').trim()
  const text = `${title}\n${body}`.trim()
  const tokens = tokenize(`${title} ${title} ${body}`)
  const id = stableId(raw.source, url, raw.externalId)

  return {
    id,
    source: raw.source,
    externalId: raw.externalId || fnv1a64(url).toString(16),
    url,
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    lang: raw.lang ?? detectLanguage(text),
    author: normalizeAuthor(raw.source, raw.author),
    publishedAt: raw.publishedAt && raw.publishedAt > 0 ? raw.publishedAt : now,
    ingestedAt: now,
    metrics: raw.metrics ?? {},
    tags: [...new Set((raw.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort(),
    entities: extractEntities(text, dictionary),
    simhash: simhash(tokens),
    origin: raw.origin,
  }
}
