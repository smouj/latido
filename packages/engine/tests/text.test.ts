import { describe, expect, it } from 'vitest'

import { fnv1a64, hammingDistance, jaccard, normalizeText, simhash, simhashSimilarity, slugify, tokenize } from '../src/text'

describe('normalizeText', () => {
  it('quita acentos, mayúsculas, URLs y puntuación', () => {
    expect(normalizeText('Rápido, ¿no? https://ejemplo.com/x ¡Sí!')).toBe('rapido no si')
  })
})

describe('tokenize', () => {
  it('descarta palabras vacías en español y en inglés', () => {
    const tokens = tokenize('El nuevo modelo de OpenAI is the best and fastest')
    expect(tokens).toContain('nuevo')
    expect(tokens).toContain('modelo')
    expect(tokens).toContain('openai')
    expect(tokens).toContain('fastest')
    expect(tokens).not.toContain('el')
    expect(tokens).not.toContain('de')
    expect(tokens).not.toContain('the')
  })

  it('ignora tokens más cortos que el mínimo', () => {
    expect(tokenize('ir a la IA de hoy')).toEqual(['hoy'])
  })
})

describe('simhash', () => {
  it('es determinista', () => {
    const tokens = tokenize('OpenAI anuncia un modelo nuevo')
    expect(simhash(tokens)).toBe(simhash([...tokens]))
    expect(simhash(tokens)).toHaveLength(16)
  })

  it('acerca textos parecidos y aleja los distintos', () => {
    const a = simhash(tokenize('OpenAI anuncia un modelo nuevo con más contexto'))
    const b = simhash(tokenize('OpenAI anuncia un modelo nuevo con mucho más contexto'))
    const c = simhash(tokenize('El tiempo en Sevilla mañana será soleado'))
    expect(simhashSimilarity(a, b)).toBeGreaterThan(simhashSimilarity(a, c))
  })

  it('mide distancia cero para hashes idénticos', () => {
    const hash = simhash(tokenize('gnu linux kernel'))
    expect(hammingDistance(hash, hash)).toBe(0)
  })

  it('devuelve el hash cero sin tokens, sin reventar', () => {
    expect(simhash([])).toBe('0000000000000000')
  })
})

describe('jaccard', () => {
  it('calcula la intersección sobre la unión', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 5)
    expect(jaccard([], ['b'])).toBe(0)
    expect(jaccard(['a'], ['a'])).toBe(1)
  })
})

describe('helpers', () => {
  it('fnv1a64 es estable entre ejecuciones', () => {
    expect(fnv1a64('latido').toString(16)).toBe(fnv1a64('latido').toString(16))
    expect(fnv1a64('latido')).not.toBe(fnv1a64('latido '))
  })

  it('slugify genera claves estables', () => {
    expect(slugify('Andrej Karpathy')).toBe('andrej-karpathy')
    expect(slugify('GTA VI')).toBe('gta-vi')
  })
})
