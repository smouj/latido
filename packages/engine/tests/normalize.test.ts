import { describe, expect, it } from 'vitest'

import { canonicalUrl, detectLanguage, extractEntities, normalizeItem } from '../src/normalize'

const NOW = 1_760_000_000_000

describe('canonicalUrl', () => {
  it('quita parámetros de seguimiento, www y barra final', () => {
    expect(canonicalUrl('https://www.example.com/nota/?utm_source=x&utm_medium=y&id=7')).toBe(
      'https://example.com/nota?id=7',
    )
  })

  it('no toca una URL que no se puede analizar', () => {
    expect(canonicalUrl('no-es-una-url')).toBe('no-es-una-url')
  })
})

describe('extractEntities', () => {
  it('detecta entidades por alias y sin duplicar', () => {
    const entities = extractEntities('OpenAI y su nuevo modelo GPT compiten con Anthropic y Claude')
    expect(entities).toEqual(['anthropic', 'openai'])
  })

  it('no confunde una palabra que contiene el alias', () => {
    expect(extractEntities('gptv es un formato de vídeo')).not.toContain('openai')
  })
})

describe('detectLanguage', () => {
  it('reconoce español e inglés', () => {
    expect(detectLanguage('El nuevo modelo de la empresa es rápido y funciona bien para todos')).toBe('es')
    expect(detectLanguage('The new model from the company is fast and it works for everyone')).toBe('en')
    expect(detectLanguage('OpenAI')).toBe('und')
  })
})

describe('normalizeItem', () => {
  it('genera un id estable por fuente y externalId', () => {
    const item = normalizeItem(
      { source: 'hackernews', externalId: '123', url: 'https://news.ycombinator.com/item?id=123', title: 'Hola', origin: 'test' },
      NOW,
    )
    expect(item.id).toBe('hackernews:123')
    expect(item.ingestedAt).toBe(NOW)
    expect(item.publishedAt).toBe(NOW)
  })

  it('el mismo enlace con parámetros distintos produce el mismo id', () => {
    const base = { source: 'rss' as const, externalId: '', url: 'https://medio.example/nota?utm_source=x', title: 'N', origin: 'test' }
    const other = { ...base, url: 'https://www.medio.example/nota' }
    expect(normalizeItem(base, NOW).id).toBe(normalizeItem(other, NOW).id)
  })

  it('extrae entidades del título y del cuerpo', () => {
    const item = normalizeItem(
      {
        source: 'reddit',
        externalId: 'x',
        url: 'https://reddit.com/x',
        title: 'NVIDIA sube precios',
        body: 'La memoria afecta al precio de las GPU',
        origin: 'test',
      },
      NOW,
    )
    expect(item.entities).toContain('nvidia')
    expect(item.simhash).toHaveLength(16)
    expect(item.tags).toEqual([])
  })

  it('normaliza el autor por defecto en vez de dejarlo vacío', () => {
    const item = normalizeItem({ source: 'demo', externalId: 'a', url: 'https://x.example/a', origin: 'test' }, NOW)
    expect(item.author.handle).toBe('desconocido')
    expect(item.author.id).toBe('demo:desconocido')
  })
})
