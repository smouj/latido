/**
 * Utilidades de texto: tokenización, similitud y simhash.
 *
 * Todo es determinista y sin dependencias: el mismo texto produce el mismo
 * hash en Rust, en Node y en el navegador, así que la indexación del escritorio
 * y la del modo web coinciden.
 */

/** Palabras vacías en español e inglés. Se recortan a mano: nada de librerías. */
export const STOPWORDS = new Set([
  // español
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con',
  'una', 'su', 'al', 'es', 'lo', 'como', 'más', 'mas', 'pero', 'sus', 'le', 'ya', 'o', 'este',
  'sí', 'si', 'porque', 'esta', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'también', 'tambien',
  'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'todos', 'uno', 'les',
  'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'e', 'esto', 'mí', 'antes', 'algunos',
  'qué', 'unos', 'yo', 'otro', 'otras', 'otra', 'él', 'tanto', 'esa', 'estos', 'mucho', 'quienes',
  'nada', 'muchos', 'cual', 'poco', 'ella', 'estar', 'estas', 'algunas', 'algo', 'nosotros', 'mi',
  'mis', 'tú', 'te', 'ti', 'tu', 'tus', 'ellas', 'nosotras', 'vosotros', 'vosotras', 'os', 'mío',
  'ser', 'son', 'fue', 'era', 'han', 'ha', 'he', 'hemos', 'está', 'estan', 'están', 'tiene',
  'tienen', 'hacer', 'hace', 'hacen', 'puede', 'pueden', 'solo', 'sólo', 'aquí', 'ahi', 'ahí',
  'así', 'asi', 'cada', 'tan', 'será', 'sera', 'va', 'van', 'ir', 'ver', 'dice', 'dijo',
  // inglés
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
  'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up',
  'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time',
  'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
  'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think',
  'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even',
  'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'is', 'are', 'was',
  'were', 'been', 'has', 'had', 'does', 'did', 'doing', 'here', 'should', 'very', 'much', 'more',
  'still', 'being', 'too', 'such', 'via', 'per', 'own', 'same', 'am', 'it\'s', 'don\'t', 'you\'re',
  'http', 'https', 'www', 'com',
])

/** Minúsculas, sin acentos, sin URLs, sin puntuación. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tokeniza y descarta palabras vacías. Mantiene números de 2+ cifras. */
export function tokenize(input: string, minLength = 3): string[] {
  const out: string[] = []
  for (const raw of normalizeText(input).split(' ')) {
    const token = raw.replace(/^[-']+|[-']+$/g, '')
    if (token.length < minLength) continue
    if (STOPWORDS.has(token)) continue
    if (/^\d+$/.test(token) && token.length < 2) continue
    out.push(token)
  }
  return out
}

/** FNV-1a de 64 bits, en BigInt. Base del simhash y de los hashes de shingle. */
export function fnv1a64(text: string): bigint {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * prime) & mask
  }
  return hash
}

/** Simhash de 64 bits sobre los tokens. Devuelve hex de 16 caracteres. */
export function simhash(tokens: string[]): string {
  if (tokens.length === 0) return '0'.repeat(16)
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)

  const vector = new Array<number>(64).fill(0)
  for (const [token, weight] of counts) {
    const hash = fnv1a64(token)
    for (let bit = 0; bit < 64; bit += 1) {
      const set = (hash >> BigInt(63 - bit)) & 1n
      vector[bit] = (vector[bit] ?? 0) + (set === 1n ? weight : -weight)
    }
  }

  let out = 0n
  for (let bit = 0; bit < 64; bit += 1) {
    if ((vector[bit] ?? 0) > 0) out |= 1n << BigInt(63 - bit)
  }
  return out.toString(16).padStart(16, '0')
}

/** Distancia de Hamming entre dos simhash hex. 0 = idénticos. */
export function hammingDistance(a: string, b: string): number {
  const left = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let count = 0
  let value = left
  while (value > 0n) {
    count += Number(value & 1n)
    value >>= 1n
  }
  return count
}

/** Jaccard sobre conjuntos de tokens. 1 = idénticos. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Similitud 0–1 a partir de la distancia de Hamming (64 bits). */
export function simhashSimilarity(a: string, b: string): number {
  return 1 - hammingDistance(a, b) / 64
}

/** Tokens más representativos: frecuencia × especificidad frente al corpus. */
export function topKeywords(
  tokens: string[],
  corpusFrequency: (token: string) => number,
  limit = 6,
): string[] {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)

  const scored = [...counts.entries()].map(([token, count]) => {
    const frequency = corpusFrequency(token)
    const specificity = 1 / (1 + Math.log1p(frequency))
    return { token, score: count * (0.35 + 0.65 * specificity) + token.length * 0.02 }
  })

  return scored
    .sort((a, b) => b.score - a.score || a.token.localeCompare(b.token))
    .slice(0, limit)
    .map((entry) => entry.token)
}

/** Título provisional: dos o tres palabras dominantes en orden de aparición. */
export function titleFromKeywords(keywords: string[], originalText: string): string {
  if (keywords.length === 0) return firstLine(originalText, 60)
  const chosen = keywords.slice(0, 3)
  return chosen.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

export function firstLine(text: string, max = 90): string {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0) ?? ''
  const clean = line.trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

/** Slug estable y sin acentos, para entidades y claves. */
export function slugify(input: string): string {
  return normalizeText(input)
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64)
}
