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
  /**
   * Sesión del navegador disponible para esta fuente, si la hay. Es opcional
   * porque el motor también corre sin aplicación de escritorio, y porque una
   * fuente puede funcionar perfectamente sin sesión.
   */
  session?: SessionProvider
}

/**
 * Sesión del navegador, ya lista para usarse.
 *
 * La cabecera viaja **solo** a los dominios declarados: la sesión de un sitio no
 * se manda nunca a otro. Esa comprobación se hace en `http.ts`, en cada petición,
 * no en quien construye la sesión.
 */
export interface SourceSession {
  /** Cabecera `Cookie` ya montada. */
  header: string
  /** Dominios a los que se puede mandar. */
  domains: string[]
  /** De dónde salió (navegador y perfil), para poder explicarlo en Ajustes. */
  origin: string
}

/** Quien sepa de sesiones lo implementa; el motor solo pregunta. */
export interface SessionProvider {
  /** Sesión activa para una fuente, o `null` si no hay ninguna. */
  sessionFor(source: SourceKind): SourceSession | null
}

/** ¿Sirve esta cookie/dominio para este host? Regla de RFC 6265. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const cleanHost = host.trim().toLowerCase().replace(/\.$/, '')
  const cleanDomain = domain.trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '')
  if (cleanHost === '' || cleanDomain === '') return false
  return cleanHost === cleanDomain || cleanHost.endsWith(`.${cleanDomain}`)
}

/** Necesidad de sesión que declara un conector. */
export interface SessionRequirement {
  /** Nombre del secreto en el llavero (uno por fuente). */
  key: string
  /** Dominios cuyas cookies hay que importar. */
  domains: string[]
  /** Qué gana el usuario al activarlo, en una línea. */
  label: string
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
  /**
   * Si la fuente puede necesitar la sesión del navegador, aquí se declara qué
   * dominios hay que importar. Sin esto, Ajustes no ofrece la opción.
   */
  session?: SessionRequirement
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
