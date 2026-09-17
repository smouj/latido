import { describe, expect, it } from 'vitest'

import { Clusterer } from '../src/cluster'
import { normalizeItem } from '../src/normalize'
import { tokenize } from '../src/text'
import type { Item, SourceKind } from '../src/types'

const NOW = 1_760_000_000_000

function item(source: SourceKind, text: string, minutesAgo = 0, externalId = text.slice(0, 24)): Item {
  return normalizeItem(
    {
      source,
      externalId,
      url: `https://example.invalid/${source}/${encodeURIComponent(externalId)}`,
      title: text,
      body: text,
      origin: 'test',
    },
    NOW - minutesAgo * 60_000,
  )
}

function assignAll(clusterer: Clusterer, items: Item[]): void {
  for (const entry of items) clusterer.assign(entry, tokenize(`${entry.title ?? ''} ${entry.body ?? ''}`))
}

describe('Clusterer', () => {
  it('agrupa la misma historia contada de cinco maneras distintas', () => {
    const clusterer = new Clusterer()
    const items = [
      item('hackernews', 'OpenAI announces new GPT model with 2M token context'),
      item('bluesky', 'OpenAI acaba de anunciar el nuevo modelo, la latencia es mínima'),
      item('reddit', 'Nuevo modelo de OpenAI disponible hoy'),
      item('mastodon', 'Introducing the new GPT model from OpenAI: cheaper and larger context'),
      item('rss', 'OpenAI presenta su modelo: más contexto y menos coste'),
      item('github', 'openai/new-model-benchmarks released'),
    ]
    assignAll(clusterer, items)

    expect(clusterer.size).toBe(1)
    const [cluster] = clusterer.all()
    expect(cluster?.itemIds).toHaveLength(6)
    expect(new Set(cluster?.sources)).toEqual(new Set(['hackernews', 'bluesky', 'reddit', 'mastodon', 'rss', 'github']))
    expect(cluster?.entities).toContain('openai')
  })

  it('no mezcla historias de entidades distintas', () => {
    const clusterer = new Clusterer()
    assignAll(clusterer, [
      item('hackernews', 'OpenAI anuncia un modelo nuevo'),
      item('reddit', 'Firefox estrena motor de fuentes nuevo'),
      item('reddit', 'NVIDIA sube el precio de sus tarjetas gráficas'),
    ])
    expect(clusterer.size).toBe(3)
  })

  it('mueve el centroide cuando llega información nueva', () => {
    const clusterer = new Clusterer()
    const first = item('hackernews', 'OpenAI anuncia un modelo nuevo con mucho contexto')
    const cluster = clusterer.assign(first, tokenize(`${first.title ?? ''}`))
    expect(cluster.centroid).toBe(first.simhash)

    // Tres items del mismo tema que NO son casi idénticos al primero: la
    // mayoría debe arrastrar el centroide fuera del primer hash.
    for (const suffix of ['uno', 'dos', 'tres']) {
      const extra = item('reddit', `OpenAI despide a un investigador clave ${suffix}`)
      clusterer.assign(extra, tokenize(`${extra.title ?? ''}`))
    }

    expect(clusterer.size).toBe(1)
    expect(cluster.centroid).not.toBe(first.simhash)
    expect(cluster.centroid).toHaveLength(16)
  })

  it('es idempotente: el mismo item no infla el tema', () => {
    const clusterer = new Clusterer()
    const first = item('rss', 'Rust en el kernel, actualización de mantenimiento')
    const cluster = clusterer.assign(first, tokenize(`${first.title ?? ''}`))
    clusterer.assign(first, tokenize(`${first.title ?? ''}`))
    expect(cluster.itemIds).toHaveLength(1)
    expect(cluster.corroborations).toBe(1)
  })

  it('fusiona temas gemelos', () => {
    // Umbral de unión imposible: forzamos dos temas idénticos y comprobamos
    // que la fase de fusión los vuelve a juntar.
    const clusterer = new Clusterer({ joinThreshold: 1.01 })
    assignAll(clusterer, [
      item('hackernews', 'OpenAI anuncia un modelo nuevo con mucho contexto'),
      item('reddit', 'OpenAI anuncia un modelo nuevo con mucho contexto'),
    ])
    expect(clusterer.size).toBe(2)
    const merged = clusterer.merge(NOW)
    expect(merged).toHaveLength(1)
    expect(clusterer.size).toBe(1)
  })

  it('retira temas inactivos y los olvida', () => {
    const clusterer = new Clusterer({ activeWindowMs: 60_000 })
    assignAll(clusterer, [item('rss', 'Noticia antigua sobre OpenWeather', 120)])
    expect(clusterer.evict(NOW)).toHaveLength(1)
    expect(clusterer.size).toBe(0)
  })
})
