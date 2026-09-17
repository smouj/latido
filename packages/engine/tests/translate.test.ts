import { describe, expect, it } from 'vitest'

import {
  TranslationQueue,
  createTranslator,
  detectLanguage,
  type TranslateContext,
  type Translator,
} from '../src/translate'

const NOW = 1_760_000_000_000

/** Una llamada capturada por el `fetch` falso, con el cuerpo ya parseado. */
interface Llamada {
  url: string
  init: RequestInit
  body: Record<string, unknown> | undefined
}

function respuestaJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * `fetch` de mentira: no hay red en los tests y así se puede mirar exactamente
 * qué se envió (URL, cabeceras y cuerpo).
 */
function fetchFalso(responder: (llamada: Llamada) => Response): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  const falso: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    // El cuerpo de los proveedores siempre es JSON serializado a mano.
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>)
    const llamada: Llamada = { url, init: init ?? {}, body }
    llamadas.push(llamada)
    return responder(llamada)
  }
  return { fetch: falso, llamadas }
}

function ctxDe(fake: typeof fetch): TranslateContext {
  return { fetch: fake, now: () => NOW }
}

/** Lee una cabecera del `init`; en los tests siempre es un objeto plano. */
function cabecera(llamada: Llamada, nombre: string): string | null {
  const headers = llamada.init.headers
  if (headers === undefined) return null
  return (headers as Record<string, string>)[nombre] ?? null
}

const ESPANOL = 'El nuevo modelo de la empresa es rápido y funciona bien para todos'
const INGLES = 'The new model from the company is fast and it works for everyone'

describe('detectLanguage', () => {
  it('reconoce español e inglés por palabras funcionales', () => {
    expect(detectLanguage(ESPANOL)).toBe('es')
    expect(detectLanguage(INGLES)).toBe('en')
  })

  it('usa la eñe como señal fuerte del español', () => {
    expect(detectLanguage('El año pasado fue muy difícil para nosotros')).toBe('es')
  })

  it('devuelve null cuando el texto es corto o no hay señal clara', () => {
    expect(detectLanguage('Hola')).toBeNull()
    expect(detectLanguage('qqq zzz www kkk')).toBeNull()
    expect(detectLanguage('   ')).toBeNull()
  })
})

describe('createTranslator', () => {
  it('con kind "none" no está disponible y falla en español', async () => {
    const { fetch } = fetchFalso(() => respuestaJson({}))
    const translator = createTranslator({ kind: 'none', target: 'es' }, ctxDe(fetch))
    expect(translator.kind).toBe('none')
    expect(translator.available).toBe(false)
    await expect(translator.translate(['Hello world'])).rejects.toThrow(/No hay proveedor de traducción configurado/)
  })

  it('LibreTranslate envía el lote y lee una respuesta de array', async () => {
    const { fetch, llamadas } = fetchFalso(() => respuestaJson({ translatedText: ['Hola', 'Adiós'] }))
    const translator = createTranslator(
      { kind: 'libre', target: 'es', endpoint: 'https://libre.example/', apiKey: 'clave-libre' },
      ctxDe(fetch),
    )
    expect(translator.available).toBe(true)

    const salida = await translator.translate(['Hello there', 'Goodbye then'])

    expect(salida).toEqual(['Hola', 'Adiós'])
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0]?.url).toBe('https://libre.example/translate')
    expect(llamadas[0]?.body).toMatchObject({
      q: ['Hello there', 'Goodbye then'],
      source: 'auto',
      target: 'es',
      format: 'text',
      api_key: 'clave-libre',
    })
  })

  it('LibreTranslate acepta una respuesta de cadena cuando solo se pide un texto', async () => {
    const { fetch } = fetchFalso(() => respuestaJson({ translatedText: 'Hola' }))
    const translator = createTranslator({ kind: 'libre', target: 'es', endpoint: 'https://libre.example' }, ctxDe(fetch))
    await expect(translator.translate(['Hello there'])).resolves.toEqual(['Hola'])
  })

  it('LibreTranslate sin endpoint no está disponible', async () => {
    const { fetch } = fetchFalso(() => respuestaJson({}))
    const translator = createTranslator({ kind: 'libre', target: 'es' }, ctxDe(fetch))
    expect(translator.available).toBe(false)
    await expect(translator.translate(['Hello there'])).rejects.toThrow(/falta la URL base/)
  })

  it('DeepL usa su host gratuito, firma la petición y normaliza el idioma', async () => {
    const { fetch, llamadas } = fetchFalso(() => respuestaJson({ translations: [{ text: 'Hola' }] }))
    const translator = createTranslator({ kind: 'deepl', target: 'en', apiKey: 'clave-deepl' }, ctxDe(fetch))

    await translator.translate(['Hola mundo'])

    expect(llamadas[0]?.url).toBe('https://api-free.deepl.com/v2/translate')
    expect(cabecera(llamadas[0] as Llamada, 'authorization')).toBe('DeepL-Auth-Key clave-deepl')
    expect(llamadas[0]?.body).toMatchObject({ text: ['Hola mundo'], target_lang: 'EN-US' })
    // Sin origen conocido, DeepL no admite 'auto': la clave ni aparece.
    expect(llamadas[0]?.body).not.toHaveProperty('source_lang')
  })

  it('DeepL incluye source_lang solo si el origen se conoce', async () => {
    const { fetch, llamadas } = fetchFalso(() => respuestaJson({ translations: [{ text: 'Hello' }] }))
    const translator = createTranslator({ kind: 'deepl', target: 'en', apiKey: 'clave' }, ctxDe(fetch))

    await translator.translate(['Hola mundo'], 'es')

    expect(llamadas[0]?.body).toMatchObject({ source_lang: 'ES', target_lang: 'EN-US' })
  })

  it('OpenAI parsea el JSON de la respuesta', async () => {
    const { fetch, llamadas } = fetchFalso(() =>
      respuestaJson({ choices: [{ message: { content: '{"translations":["Hola","Adiós"]}' } }] }),
    )
    const translator = createTranslator({ kind: 'openai', target: 'es', apiKey: 'clave-openai' }, ctxDe(fetch))

    const salida = await translator.translate(['Hello there', 'Goodbye then'])

    expect(salida).toEqual(['Hola', 'Adiós'])
    expect(llamadas[0]?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(cabecera(llamadas[0] as Llamada, 'authorization')).toBe('Bearer clave-openai')
    expect(llamadas[0]?.body).toMatchObject({ model: 'gpt-4o-mini', temperature: 0 })
  })

  it('OpenAI tolera el JSON envuelto en cercas de código', async () => {
    const { fetch } = fetchFalso(() =>
      respuestaJson({ choices: [{ message: { content: '```json\n{"translations":["Hola"]}\n```' } }] }),
    )
    const translator = createTranslator({ kind: 'openai', target: 'es', apiKey: 'clave' }, ctxDe(fetch))

    await expect(translator.translate(['Hello there'])).resolves.toEqual(['Hola'])
  })

  it('OpenAI falla si el número de traducciones no coincide', async () => {
    const { fetch } = fetchFalso(() =>
      respuestaJson({ choices: [{ message: { content: '{"translations":["Hola"]}' } }] }),
    )
    const translator = createTranslator({ kind: 'openai', target: 'es', apiKey: 'clave' }, ctxDe(fetch))

    await expect(translator.translate(['Hello there', 'Goodbye then'])).rejects.toThrow(
      /se pidieron 2 traducciones y devolvió 1/,
    )
  })

  it('no envía textos vacíos ni de espacios: los deja tal cual', async () => {
    const { fetch, llamadas } = fetchFalso((llamada) => {
      const q = llamada.body?.q as string[]
      return respuestaJson({ translatedText: q.map((texto) => `«${texto}»`) })
    })
    const translator = createTranslator({ kind: 'libre', target: 'es', endpoint: 'https://libre.example' }, ctxDe(fetch))

    const salida = await translator.translate(['', '   ', 'Hello there'])

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0]?.body?.q).toEqual(['Hello there'])
    expect(salida).toEqual(['', '   ', '«Hello there»'])
  })
})

describe('TranslationQueue', () => {
  it('deduplica, usa la caché y baja pending a cero', async () => {
    const cache = new Map<string, string>()
    const resultados: { source: string; target: string; text: string; key: string }[] = []
    const { fetch, llamadas } = fetchFalso(() => respuestaJson({ translatedText: ['Hola mundo'] }))
    const translator = createTranslator({ kind: 'libre', target: 'es', endpoint: 'https://libre.example' }, ctxDe(fetch))
    const queue = new TranslationQueue({
      translator,
      cache,
      target: 'es',
      onResult: (entrada) => resultados.push(entrada),
      minIntervalMs: 0,
    })

    queue.enqueue(['Hello world', 'Hello world'])
    expect(queue.pending).toBe(1)

    const traducidos = await queue.flush()

    expect(traducidos).toBe(1)
    expect(llamadas).toHaveLength(1)
    expect(resultados).toHaveLength(1)
    expect(resultados[0]).toEqual({
      source: 'Hello world',
      target: 'es',
      text: 'Hola mundo',
      key: 'es\u0000Hello world',
    })
    expect(cache.get('es\u0000Hello world')).toBe('Hola mundo')
    expect(queue.pending).toBe(0)

    // Repetirlo ya no gasta red: la caché lo corta antes de encolar.
    queue.enqueue(['Hello world'])
    expect(queue.pending).toBe(0)
    await queue.flush()
    expect(llamadas).toHaveLength(1)
  })

  it('no encola lo que ya está en el idioma destino', async () => {
    const { fetch, llamadas } = fetchFalso((llamada) => {
      const q = llamada.body?.q as string[]
      return respuestaJson({ translatedText: q.map((texto) => `«${texto}»`) })
    })
    const translator = createTranslator({ kind: 'libre', target: 'es', endpoint: 'https://libre.example' }, ctxDe(fetch))
    const queue = new TranslationQueue({ translator, cache: new Map(), target: 'es', onResult: () => {} })

    queue.enqueue([ESPANOL, 'English text here everyone'])

    expect(queue.pending).toBe(1)
    const traducidos = await queue.flush()
    expect(traducidos).toBe(1)
    expect(llamadas[0]?.body?.q).toEqual(['English text here everyone'])
  })

  it('respeta batchSize y concurrency conservando el orden', async () => {
    const { fetch, llamadas } = fetchFalso((llamada) => {
      const q = llamada.body?.q as string[]
      return respuestaJson({ translatedText: q.map((texto) => `[${texto}]`) })
    })
    const translator = createTranslator({ kind: 'libre', target: 'es', endpoint: 'https://libre.example' }, ctxDe(fetch))
    const queue = new TranslationQueue({
      translator,
      cache: new Map(),
      target: 'es',
      onResult: () => {},
      batchSize: 1,
      concurrency: 2,
      minIntervalMs: 0,
    })

    queue.enqueue(['Hello world one', 'Hello world two', 'Hello world three'])
    const traducidos = await queue.flush()

    expect(traducidos).toBe(3)
    expect(llamadas).toHaveLength(3)
    expect(llamadas.every((llamada) => (llamada.body?.q as string[]).length === 1)).toBe(true)
    expect(queue.pending).toBe(0)
  })

  it('los errores no escapan: van a onError y la cola sigue viva', async () => {
    const errores: Error[] = []
    const resultados: string[] = []
    const { fetch } = fetchFalso(() => new Response('boom', { status: 500 }))
    const translator = createTranslator({ kind: 'libre', target: 'es', endpoint: 'https://libre.example' }, ctxDe(fetch))
    const queue = new TranslationQueue({
      translator,
      cache: new Map(),
      target: 'es',
      // Un consumidor que revienta tampoco puede tumbar el flush.
      onResult: () => {
        resultados.push('no debería llegar')
        throw new Error('onResult roto')
      },
      onError: (error) => errores.push(error),
      minIntervalMs: 0,
    })

    queue.enqueue(['Hello world'])

    await expect(queue.flush()).resolves.toBe(1)
    expect(errores).toHaveLength(1)
    expect(errores[0]?.message).toContain('LibreTranslate: HTTP 500')
    expect(resultados).toEqual([])
    expect(queue.pending).toBe(0)
  })

  it('uno de los proveedores caídos no impide traducir el resto', async () => {
    const errores: Error[] = []
    const resultados: string[] = []
    const translatorFalso: Translator = {
      kind: 'libre',
      available: true,
      async translate(texts) {
        if (texts.some((texto) => texto.includes('boom'))) throw new Error('proveedor caído')
        return texts.map((texto) => `«${texto}»`)
      },
    }
    const queue = new TranslationQueue({
      translator: translatorFalso,
      cache: new Map(),
      target: 'es',
      onResult: (entrada) => resultados.push(entrada.text),
      onError: (error) => errores.push(error),
      batchSize: 1,
      minIntervalMs: 0,
    })

    queue.enqueue(['Hello world', 'Hello boom', 'Hello again'])
    const traducidos = await queue.flush()

    expect(traducidos).toBe(3)
    expect(errores).toHaveLength(1)
    expect(resultados.sort()).toEqual(['«Hello again»', '«Hello world»'])
    expect(queue.pending).toBe(0)
  })

  it('clear() vacía la cola', async () => {
    const translatorFalso: Translator = { kind: 'none', available: false, translate: async () => [] }
    const queue = new TranslationQueue({ translator: translatorFalso, cache: new Map(), target: 'es', onResult: () => {} })

    queue.enqueue(['Hello world one', 'Hello world two'])
    expect(queue.pending).toBe(2)

    queue.clear()
    expect(queue.pending).toBe(0)
    await expect(queue.flush()).resolves.toBe(0)
  })
})
