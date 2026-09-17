/** Formato de fechas, números y métricas en la interfaz. Español primero. */

const LOCALES: Record<string, string> = { es: 'es-ES', en: 'en-US' }

export function localeOf(lang: string): string {
  return LOCALES[lang] ?? 'es-ES'
}

/** "hace 4 min", "hace 2 h", "ayer 13:40". Nunca una fecha cruda. */
export function relativeTime(timestamp: number, now = Date.now(), lang = 'es'): string {
  const diff = Math.max(0, now - timestamp)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return lang === 'es' ? 'ahora' : 'now'
  if (minutes < 60) return lang === 'es' ? `hace ${minutes} min` : `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return lang === 'es' ? `hace ${hours} h` : `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return lang === 'es' ? 'ayer' : 'yesterday'
  if (days < 7) return lang === 'es' ? `hace ${days} días` : `${days} days ago`
  return new Date(timestamp).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short' })
}

/** Hora corta: 12:41. */
export function clockTime(timestamp: number, lang = 'es'): string {
  return new Date(timestamp).toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit' })
}

/** Fecha larga para la cabecera: jueves, 17 de septiembre. */
export function longDate(timestamp: number, lang = 'es'): string {
  return new Date(timestamp).toLocaleDateString(localeOf(lang), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** 8200 → "8,2 mil". 1_240_000 → "1,2 M". */
export function compactNumber(value: number, lang = 'es'): string {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  const suffix = { k: lang === 'es' ? ' mil' : 'K', m: ' M', b: lang === 'es' ? ' mil M' : 'B' }
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}${suffix.b}`
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}${suffix.m}`
  if (abs >= 1000) return `${trim(value / 1000)}${suffix.k}`
  return String(Math.round(value))
}

function trim(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 })
}

/** Multiplicador: 5.8 → "×5,8". */
export function times(value: number, lang = 'es'): string {
  const formatted = value.toLocaleString(localeOf(lang), { maximumFractionDigits: 1 })
  return `×${formatted}`
}

/** Variación: 0.86 → "+86 %". */
export function percent(value: number, lang = 'es'): string {
  const rounded = Math.round(value * 100)
  const formatted = Math.abs(rounded).toLocaleString(localeOf(lang))
  return `${rounded >= 0 ? '+' : '−'}${formatted} %`
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Iniciales para el avatar cuando no hay imagen. */
export function initialsOf(name: string): string {
  const parts = name.replace(/^[@u/]+/, '').split(/[\s._-]+/).filter(Boolean)
  const first = parts[0]?.charAt(0) ?? '?'
  const second = parts.length > 1 ? (parts[1]?.charAt(0) ?? '') : ''
  return `${first}${second}`.toUpperCase()
}

/** Color estable por cadena: los avatares no bailan entre renders. */
export function hueOf(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360
  }
  return hash
}
