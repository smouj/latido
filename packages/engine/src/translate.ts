/**
 * Traducción del motor.
 *
 * La app no habla con proveedores: pide un `Translator` y el motor decide cómo.
 * Como en los conectores, todo lo de fuera (red y reloj) entra por contexto, sin
 * estado global ni I/O implícito; así el módulo se prueba con un `fetch` falso.
 *
 * Regla de oro de cuota: un texto vacío nunca sale a la red. Traducir un hueco
 * no aporta nada y gasta una petición del lote, que es justo lo que se paga.
 */

export type TranslateProviderKind = 'none' | 'libre' | 'deepl' | 'openai'

export interface TranslateConfig {
  kind: TranslateProviderKind
  /** Idioma destino, código ISO corto: 'es', 'en'. */
  target: string
  /** URL base para LibreTranslate, p. ej. 'https://libretranslate.com'. */
  endpoint?: string
  apiKey?: string
  /** Modelo de chat, solo para openai. Por defecto 'gpt-4o-mini'. */
  model?: string
  /** Máximo de textos por petición. Por defecto 16. */
  batchSize?: number
  /** Peticiones simultáneas máximas. Por defecto 2. */
  concurrency?: number
}

export interface TranslateContext {
  /** `fetch` inyectado: en Node el global, en Tauri el proxy sin CORS. */
  fetch: typeof fetch
  /** Reloj inyectado; la cola lo usa para espaciar tandas. */
  now: () => number
}

/**
 * Marcadores funcionales por idioma. Listas cortas y revisables a mano: no hay
 * modelos ni datos descargados, y cualquiera puede discutir una palabra concreta
 * mirando esta tabla.
 */
const LANGUAGE_MARKERS: Record<string, string[]> = {
  es: ['que', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'con', 'es', 'son', 'está', 'esta', 'este', 'pero', 'porque', 'muy', 'también', 'desde', 'hasta', 'como', 'más', 'fue', 'han', 'tiene', 'puede', 'donde', 'cuando', 'entre', 'sobre', 'sin', 'hay', 'todo', 'todos', 'su', 'al', 'del', 'se', 'por', 'y', 'o', 'ya', 'lo', 'nos'],
  en: ['the', 'and', 'of', 'is', 'are', 'was', 'were', 'to', 'in', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'will', 'not', 'but', 'you', 'they', 'we', 'it', 'as', 'at', 'on', 'by', 'or', 'an', 'be', 'been', 'their', 'there', 'what', 'which', 'when', 'where', 'who', 'how', 'because', 'about', 'into', 'more', 'most', 'some', 'such', 'can', 'could', 'would', 'should', 'very', 'also', 'than', 'then', 'them', 'these', 'those'],
  fr: ['le', 'les', 'des', 'une', 'un', 'et', 'est', 'pour', 'avec', 'que', 'qui', 'dans', 'sur', 'plus', 'pas', 'nous', 'vous', 'je', 'il', 'elle', 'ce', 'cette', 'au', 'aux', 'du', 'son', 'sa', 'ses', 'mais', 'ou', 'où', 'être', 'sont', 'été', 'votre', 'notre', 'leur', 'leurs', 'ainsi', 'donc', 'comme', 'tout', 'tous', 'bien', 'fait', 'de', 'la'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'einen', 'mit', 'für', 'sich', 'den', 'dem', 'des', 'auch', 'auf', 'aus', 'bei', 'nach', 'werden', 'wird', 'sind', 'von', 'zu', 'im', 'zur', 'zum', 'dass', 'wie', 'aber', 'noch', 'nur', 'kann', 'muss', 'über', 'unter', 'zwischen', 'wenn', 'als', 'sein', 'seine', 'diese', 'dieser', 'dieses'],
  pt: ['que', 'não', 'nao', 'uma', 'um', 'para', 'com', 'os', 'as', 'do', 'da', 'dos', 'das', 'em', 'por', 'mais', 'como', 'mas', 'foi', 'são', 'sao', 'está', 'esta', 'isso', 'ele', 'ela', 'você', 'voce', 'nós', 'nos', 'também', 'tambem', 'já', 'ja', 'até', 'ate', 'muito', 'quando', 'onde', 'seu', 'sua', 'seus', 'suas', 'ao', 'aos', 'todos'],
  it: ['il', 'che', 'di', 'una', 'un', 'per', 'con', 'non', 'sono', 'è', 'e', 'anche', 'più', 'piu', 'come', 'ma', 'questo', 'questa', 'gli', 'le', 'lo', 'dei', 'delle', 'della', 'nel', 'nella', 'si', 'ha', 'hanno', 'molto', 'quando', 'dove', 'suo', 'sua', 'loro', 'essere', 'stato', 'dopo', 'prima', 'senza', 'tra', 'fra', 'dal', 'dalla', 'la'],
}

/**
 * Señales de carácter: la 'ñ' o el '¿' casi no aparecen fuera del español, así
 * que pesan más que una palabra suelta. La 'ç' se reparte entre francés y
 * portugués porque en ambos es corriente.
 */
const CHAR_HINTS: { lang: string; pattern: RegExp; weight: number }[] = [
  { lang: 'es', pattern: /[ñ¿¡]/, weight: 3 },
  { lang: 'de', pattern: /ß/, weight: 3 },
  { lang: 'pt', pattern: /[ãõ]/, weight: 3 },
  { lang: 'fr', pattern: /œ/, weight: 3 },
  { lang: 'fr', pattern: /ç/, weight: 1 },
  { lang: 'pt', pattern: /ç/, weight: 1 },
]

/**
 * Peso de cada marcador: las palabras que solo aparecen en un idioma valen el
 * doble. Se calcula del propio diccionario, así que añadir una palabra no obliga
 * a mantener dos tablas en sincronía.
 */
const MARKER_WEIGHTS: Map<string, number> = (() => {
  const apariciones = new Map<string, number>()
  for (const markers of Object.values(LANGUAGE_MARKERS)) {
    for (const marker of markers) apariciones.set(marker, (apariciones.get(marker) ?? 0) + 1)
  }
  const weights = new Map<string, number>()
  for (const [marker, count] of apariciones) weights.set(marker, count === 1 ? 2 : 1)
  return weights
})()

/** Menos de esto no da señal: una palabra suelta no es un idioma. */
const MIN_DETECT_LENGTH = 12

/** Puntúa cada idioma y devuelve el ganador claro, o null si hay empate/duda. */
function scoreLanguages(text: string): Map<string, number> {
  const lower = text.toLowerCase()
  // Se conservan letras y acentos (las señales de carácter viven ahí) y todo lo
  // demás pasa a espacio, para poder comparar palabras completas con `includes`.
  const words = ` ${lower.replace(/[^\p{L}\s'-]+/gu, ' ').replace(/\s+/g, ' ').trim()} `

  const scores = new Map<string, number>()
  const add = (lang: string, weight: number): void => {
    scores.set(lang, (scores.get(lang) ?? 0) + weight)
  }

  for (const hint of CHAR_HINTS) if (hint.pattern.test(lower)) add(hint.lang, hint.weight)
  for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS)) {
    for (const marker of markers) {
      if (!words.includes(` ${marker} `)) continue
      add(lang, MARKER_WEIGHTS.get(marker) ?? 1)
    }
  }
  return scores
}

/**
 * Detección de idioma baratísima y explicable: cuenta palabras funcionales y
 * caracteres propios. Es *deliberadamente humilde*: si el texto es corto o las
 * señales no son claras, devuelve `null` en vez de inventarse un idioma. Falla
 * hacia el silencio, porque una detección errónea aquí provoca traducciones
 * absurdas en la interfaz.
 */
export function detectLanguage(text: string): string | null {
  const raw = text.trim()
  if (raw.length < MIN_DETECT_LENGTH) return null

  let mejor: string | null = null
  let mejorPuntos = 0
  let empate = false
  for (const [lang, puntos] of scoreLanguages(raw)) {
    if (puntos > mejorPuntos) {
      mejor = lang
      mejorPuntos = puntos
      empate = false
    } else if (puntos === mejorPuntos && puntos > 0) {
      empate = true
    }
  }

  // Dos puntos como mínimo: una sola coincidencia suele ser casualidad.
  if (mejor === null || mejorPuntos < 2 || empate) return null
  return mejor
}

export interface Translator {
  readonly kind: TranslateProviderKind
  readonly available: boolean
  /** Traduce una lista y devuelve el mismo orden. Lanza si el proveedor falla. */
  translate(texts: string[], source?: string): Promise<string[]>
}

/** Envía un lote ya limpio (sin vacíos) y devuelve las traducciones en orden. */
type SendBatch = (texts: string[], source: string | undefined) => Promise<string[]>

const DEFAULT_BATCH_SIZE = 16
const DEFAULT_CONCURRENCY = 2
const DEFAULT_MIN_INTERVAL_MS = 250
const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1'
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini'
const DEEPL_FREE_BASE = 'https://api-free.deepl.com'

/** Un `Translator` es un envío con puerta: si no está disponible, no hay envío. */
function makeTranslator(kind: TranslateProviderKind, unavailable: string | null, send: SendBatch): Translator {
  const available = unavailable === null
  return {
    kind,
    available,
    async translate(texts: string[], source?: string): Promise<string[]> {
      if (unavailable !== null) throw new Error(unavailable)
      return translatePreservingBlanks(texts, send, source)
    },
  }
}

/**
 * Traduce solo lo que tiene contenido y devuelve la lista original con los
 * huecos intactos: el llamante puede mapear 1:1 con su lista de entrada.
 */
async function translatePreservingBlanks(
  texts: string[],
  send: SendBatch,
  source: string | undefined,
): Promise<string[]> {
  const salida = [...texts]
  const indices: number[] = []
  const envio: string[] = []
  texts.forEach((texto, index) => {
    if (texto.trim() === '') return
    indices.push(index)
    envio.push(texto)
  })
  if (envio.length === 0) return salida

  const traducidos = await send(envio, source)
  if (traducidos.length !== envio.length) {
    throw new Error(`el proveedor devolvió ${traducidos.length} textos y se pidieron ${envio.length}`)
  }
  indices.forEach((index, posicion) => {
    salida[index] = traducidos[posicion] ?? texts[index] ?? ''
  })
  return salida
}

/**
 * Crea el traductor del proveedor configurado. `available` es falso cuando falta
 * lo imprescindible (endpoint o clave) o cuando no hay proveedor: en los tres
 * casos el objeto existe y falla con un mensaje en español que la UI puede
 * enseñar tal cual, en vez de reventar al construir la pantalla de ajustes.
 */
export function createTranslator(config: TranslateConfig, ctx: TranslateContext): Translator {
  switch (config.kind) {
    case 'none':
      return makeTranslator(
        'none',
        'No hay proveedor de traducción configurado: elige LibreTranslate, DeepL u OpenAI en Ajustes.',
        async () => [],
      )
    case 'libre':
      return makeTranslator(
        'libre',
        hasText(config.endpoint) ? null : 'LibreTranslate: falta la URL base (config.endpoint).',
        libreSend(config, ctx),
      )
    case 'deepl':
      return makeTranslator(
        'deepl',
        hasText(config.apiKey) ? null : 'DeepL: falta la clave de API (config.apiKey).',
        deeplSend(config, ctx),
      )
    case 'openai':
      return makeTranslator(
        'openai',
        hasText(config.apiKey) ? null : 'OpenAI: falta la clave de API (config.apiKey).',
        openaiSend(config, ctx),
      )
    default:
      return makeTranslator(
        'none',
        `Proveedor de traducción desconocido: "${String(config.kind)}".`,
        async () => [],
      )
  }
}

function libreSend(config: TranslateConfig, ctx: TranslateContext): SendBatch {
  const base = stripTrailingSlash(config.endpoint ?? '')
  return async (texts, source) => {
    const json = await postJson(
      ctx,
      `${base}/translate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          q: texts,
          source: source ?? 'auto',
          target: config.target,
          format: 'text',
          ...(hasText(config.apiKey) ? { api_key: config.apiKey } : {}),
        }),
      },
      'LibreTranslate',
    )

    const translated = isRecord(json) ? json.translatedText : undefined
    if (Array.isArray(translated)) {
      const lista = requireStrings(translated, 'LibreTranslate')
      if (lista.length !== texts.length) {
        throw new Error(`LibreTranslate: se pidieron ${texts.length} traducciones y devolvió ${lista.length}.`)
      }
      return lista
    }
    // Algunas versiones devuelven cadena cuando solo se pide un texto.
    if (typeof translated === 'string' && texts.length === 1) return [translated]
    throw new Error('LibreTranslate: la respuesta no trae "translatedText" en el formato esperado.')
  }
}

function deeplSend(config: TranslateConfig, ctx: TranslateContext): SendBatch {
  // El host gratuito es el de por defecto; el de pago se indica con endpoint.
  const base = stripTrailingSlash(config.endpoint ?? DEEPL_FREE_BASE)
  return async (texts, source) => {
    // DeepL no acepta 'auto' explícito: o se sabe el origen, o se omite.
    const origen = hasText(source) && source !== 'auto' ? deeplSourceLang(source) : null
    const json = await postJson(
      ctx,
      `${base}/v2/translate`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `DeepL-Auth-Key ${config.apiKey ?? ''}`,
        },
        body: JSON.stringify({
          text: texts,
          target_lang: deeplTargetLang(config.target),
          ...(origen !== null ? { source_lang: origen } : {}),
        }),
      },
      'DeepL',
    )

    const lista = isRecord(json) ? json.translations : undefined
    if (!Array.isArray(lista)) throw new Error('DeepL: la respuesta no trae la lista "translations".')
    return lista.map((entrada, index) => {
      const texto = isRecord(entrada) ? entrada.text : undefined
      if (typeof texto !== 'string') throw new Error(`DeepL: la traducción ${index} no trae texto.`)
      return texto
    })
  }
}

function openaiSend(config: TranslateConfig, ctx: TranslateContext): SendBatch {
  const base = stripTrailingSlash(config.endpoint ?? OPENAI_DEFAULT_BASE)
  const model = config.model ?? OPENAI_DEFAULT_MODEL
  return async (texts, source) => {
    const json = await postJson(
      ctx,
      `${base}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${config.apiKey ?? ''}`,
        },
        body: JSON.stringify({
          model,
          // Cero creatividad: aquí queremos una función, no un redactor.
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify({ target: config.target, source: source ?? 'auto', texts }) },
          ],
        }),
      },
      'OpenAI',
    )

    const objeto = extractJsonObject(chatContent(json))
    if (!isRecord(objeto)) throw new Error('OpenAI: la respuesta no es un objeto JSON.')
    const traducciones = objeto.translations
    if (!Array.isArray(traducciones)) throw new Error('OpenAI: la respuesta no trae la lista "translations".')
    const salida = requireStrings(traducciones, 'OpenAI')
    // Un modelo puede devolver menos entradas de las pedidas; eso desalinea el
    // feed, así que es un error y no un aviso.
    if (salida.length !== texts.length) {
      throw new Error(`OpenAI: se pidieron ${texts.length} traducciones y devolvió ${salida.length}.`)
    }
    return salida
  }
}

const SYSTEM_PROMPT = [
  'Eres un traductor automático dentro de una app de lectura.',
  'Recibes un JSON con "target" (código del idioma destino) y "texts" (lista de textos).',
  'Devuelve EXCLUSIVAMENTE un objeto JSON con la forma {"translations": ["...", "..."]}.',
  'Devuelve exactamente el mismo número de elementos que "texts" y en el mismo orden.',
  'No traduzcas lo que ya esté en el idioma destino: cópialo tal cual.',
  'Sin explicaciones, sin texto adicional y sin marcas de código.',
].join(' ')

/** Extrae el contenido del primer mensaje de una respuesta de chat. */
function chatContent(json: unknown): string {
  if (!isRecord(json)) throw new Error('OpenAI: la respuesta no es un objeto JSON.')
  const choices = json.choices
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('OpenAI: la respuesta no trae "choices".')
  const primera = choices[0]
  const message = isRecord(primera) ? primera.message : undefined
  const content = isRecord(message) ? message.content : undefined
  if (typeof content !== 'string' || content.trim() === '') throw new Error('OpenAI: la respuesta no trae contenido.')
  return content
}

/**
 * Saca el objeto JSON del contenido, tolerando cercas ```json``` y algún
 * preámbulo. Se queda con lo que hay entre la primera `{` y la última `}`: es
 * más robusto que confiar en que el modelo obedezca al pie de la letra.
 */
function extractJsonObject(content: string): unknown {
  const limpio = content.replace(/```[a-z]*/gi, '').trim()
  const inicio = limpio.indexOf('{')
  const fin = limpio.lastIndexOf('}')
  if (inicio === -1 || fin < inicio) throw new Error('OpenAI: el contenido no tiene un objeto JSON.')
  try {
    return JSON.parse(limpio.slice(inicio, fin + 1))
  } catch {
    throw new Error('OpenAI: el JSON de la respuesta no se puede parsear.')
  }
}

export interface QueueOptions {
  translator: Translator
  /** Cache: clave = idioma destino + '\u0000' + texto original. */
  cache: Map<string, string>
  onResult: (entry: { source: string; target: string; text: string; key: string }) => void
  onError?: (error: Error) => void
  target: string
  batchSize?: number
  concurrency?: number
  /** Milisegundos mínimos entre tandas. Por defecto 250. */
  minIntervalMs?: number
  now?: () => number
}

/**
 * Cola de traducción: agrupa textos, evita repetir trabajo y espacia las tandas.
 *
 * Nunca lanza hacia fuera. Una cola de fondo que revienta el hilo que la usa es
 * un bug garantizado, así que todo fallo va a `onError` y el ciclo sigue. Los
 * textos que fallan se descartan (no se cachean), de modo que volver a
 * encolarlos es un reintento válido.
 */
export class TranslationQueue {
  private readonly pendientes: string[] = []
  /** Claves ya en cola, para no encolar dos veces el mismo texto. */
  private readonly enCola = new Set<string>()
  private readonly cache: Map<string, string>
  private readonly targetCode: string
  private readonly batchSize: number
  private readonly concurrency: number
  private readonly minIntervalMs: number
  private readonly now: () => number
  private lastRoundAt: number | null = null

  constructor(private readonly options: QueueOptions) {
    this.cache = options.cache
    this.targetCode = primarySubtag(options.target)
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE))
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY))
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS)
    this.now = options.now ?? ((): number => Date.now())
  }

  /** Encola textos; ignora los que ya están en la caché o ya están en el idioma destino. */
  enqueue(texts: string[]): void {
    for (const text of texts) {
      if (typeof text !== 'string' || text.trim() === '') continue
      // Si ya está en el idioma destino, traducir solo puede empeorarlo.
      if (detectLanguage(text) === this.targetCode) continue
      const key = translationKey(this.targetCode, text)
      if (this.cache.has(key) || this.enCola.has(key)) continue
      this.enCola.add(key)
      this.pendientes.push(text)
    }
  }

  /**
   * Traduce lo que haya ahora mismo y espera. Devuelve cuántos entraron.
   *
   * Se queda con una foto de la cola al empezar: lo que llegue mientras se
   * traduce espera al siguiente `flush`, así el valor devuelto es exacto.
   */
  async flush(): Promise<number> {
    const lote = this.pendientes.splice(0)
    for (const text of lote) this.enCola.delete(translationKey(this.targetCode, text))
    if (lote.length === 0) return 0

    const porTanda = this.batchSize * this.concurrency
    for (let inicio = 0; inicio < lote.length; inicio += porTanda) {
      if (inicio > 0) await this.waitBetweenRounds()
      const tandas: string[][] = []
      for (let slot = 0; slot < this.concurrency; slot += 1) {
        const desde = inicio + slot * this.batchSize
        const tanda = lote.slice(desde, desde + this.batchSize)
        if (tanda.length > 0) tandas.push(tanda)
      }
      this.lastRoundAt = this.now()
      // `runBatch` no rechaza nunca, así que el Promise.all tampoco.
      await Promise.all(tandas.map((tanda) => this.runBatch(tanda)))
    }
    return lote.length
  }

  get pending(): number {
    return this.pendientes.length
  }

  clear(): void {
    this.pendientes.length = 0
    this.enCola.clear()
  }

  private async waitBetweenRounds(): Promise<void> {
    if (this.lastRoundAt === null) return
    const espera = this.minIntervalMs - (this.now() - this.lastRoundAt)
    if (espera > 0) await sleep(espera)
  }

  private async runBatch(tanda: string[]): Promise<void> {
    let traducidos: string[]
    try {
      traducidos = await this.options.translator.translate(tanda)
    } catch (error) {
      this.report(toError(error))
      return
    }

    tanda.forEach((texto, index) => {
      const traducido = traducidos[index]
      if (typeof traducido !== 'string') {
        this.report(new Error(`traducción incompleta: falta el resultado ${index} de la tanda`))
        return
      }
      const key = translationKey(this.targetCode, texto)
      this.cache.set(key, traducido)
      try {
        this.options.onResult({ source: texto, target: this.targetCode, text: traducido, key })
      } catch (error) {
        // Un consumidor roto no puede tumbar la cola entera.
        this.report(toError(error))
      }
    })
  }

  private report(error: Error): void {
    try {
      this.options.onError?.(error)
    } catch {
      // Si el propio manejador falla, se traga: la cola nunca lanza.
    }
  }
}

/** Clave de caché: idioma destino, separador nulo y texto original. */
function translationKey(target: string, text: string): string {
  return `${target}\u0000${text}`
}

/**
 * Código principal del idioma: 'EN-US' y 'en' deben compartir caché, o el mismo
 * texto se traduciría dos veces al cambiar de variante.
 */
function primarySubtag(language: string): string {
  const code = language.trim().toLowerCase().split(/[-_]/)[0]
  return code ?? ''
}

/** DeepL exige mayúsculas y un regionalismo concreto para el inglés de destino. */
function deeplTargetLang(target: string): string {
  const code = target.trim().toUpperCase()
  if (code === 'EN') return 'EN-US'
  return code
}

/** Como origen, DeepL no quiere el regionalismo: 'EN-US' sobra, basta 'EN'. */
function deeplSourceLang(source: string): string {
  const code = source.trim().toUpperCase().split(/[-_]/)[0]
  return code ?? source.trim().toUpperCase()
}

async function postJson(ctx: TranslateContext, url: string, init: RequestInit, provider: string): Promise<unknown> {
  let response: Response
  try {
    response = await ctx.fetch(url, init)
  } catch (error) {
    throw new Error(`${provider}: no se pudo conectar con ${url} (${describeError(error)}).`)
  }

  if (!response.ok) {
    const detalle = await safeText(response)
    throw new Error(`${provider}: HTTP ${response.status}${detalle ? ` — ${detalle.slice(0, 200)}` : ''}`)
  }

  try {
    return await response.json()
  } catch {
    throw new Error(`${provider}: la respuesta no es JSON válido.`)
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim()
  } catch {
    return ''
  }
}

function requireStrings(value: unknown[], provider: string): string[] {
  const salida: string[] = []
  for (const entrada of value) {
    if (typeof entrada !== 'string') throw new Error(`${provider}: llegó una traducción que no es texto.`)
    salida.push(entrada)
  }
  return salida
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
