import type { RawItem } from '../normalize'
import type { SourceConfig, SourceKind } from '../types'

/** Todo lo que un conector puede usar del exterior. Nada más, por diseño. */
export interface FetchContext {
  /** `fetch` inyectado: en Node es el global, en Tauri un proxy sin CORS. */
  fetch: typeof fetch
  now: number
  limit?: number
  signal?: AbortSignal
  /** Traza opcional; la app la muestra en Fuentes. */
  log?: (message: string) => void
}

export interface Connector {
  kind: SourceKind
  label: string
  /** true = el navegador no puede llamarla directamente; el escritorio sí. */
  requiresProxy: boolean
  /** Ritmo mínimo recomendado entre sondeos. */
  defaultPollMs: number
  /** Qué se puede configurar, para que Ajustes pinte el formulario solo. */
  options: { key: string; label: string; placeholder: string; defaultValue?: string }[]
  fetchItems(config: SourceConfig, ctx: FetchContext): Promise<RawItem[]>
}

export class SourceError extends Error {
  constructor(
    readonly source: SourceKind,
    message: string,
    readonly status?: number,
  ) {
    super(`[${source}] ${message}`)
    this.name = 'SourceError'
  }
}

/** Acepta tanto `string` como `string[]` en las opciones. */
export function optionList(config: SourceConfig, key: string, fallback: string[] = []): string[] {
  const value = config.options[key]
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return fallback
}

export function optionNumber(config: SourceConfig, key: string, fallback: number): number {
  const value = config.options[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}
