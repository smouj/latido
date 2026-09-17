/**
 * Puente con la plataforma.
 *
 * La misma interfaz corre en dos sitios muy distintos:
 *  - **Escritorio (Tauri)**: almacenamiento en SQLite, notificaciones del
 *    sistema, abrir enlaces con el navegador del sistema y peticiones sin CORS.
 *  - **Navegador**: IndexedDB, notificaciones web y `window.open`.
 *
 * Todo lo que depende del entorno vive aquí. Ningún componente pregunta nunca
 * "¿estoy en Tauri?".
 */

const DESKTOP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const isDesktop = (): boolean => DESKTOP

export const platformName = (): string => (DESKTOP ? 'escritorio' : 'navegador')

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core')
  return call<T>(command, args)
}

// ── almacenamiento ──────────────────────────────────────────────────────────

const DB_NAME = 'latido'
const STORE_NAME = 'state'
const KEY = 'snapshot'
const FALLBACK_KEY = 'latido:snapshot'

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function idbGet(): Promise<string | null> {
  const database = await openDatabase()
  if (!database) return null
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(KEY)
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null)
    request.onerror = () => resolve(null)
  })
}

async function idbSet(value: string): Promise<boolean> {
  const database = await openDatabase()
  if (!database) return false
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(value, KEY)
    transaction.oncomplete = () => resolve(true)
    transaction.onerror = () => resolve(false)
  })
}

async function idbClear(): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
  })
}

/** Lee el estado guardado. Devuelve `null` en un primer arranque. */
export async function loadState(): Promise<string | null> {
  if (DESKTOP) {
    try {
      return await invoke<string | null>('state_load')
    } catch {
      return null
    }
  }
  const fromIdb = await idbGet()
  if (fromIdb !== null) return fromIdb
  try {
    return window.localStorage.getItem(FALLBACK_KEY)
  } catch {
    return null
  }
}

/** Guarda el estado. Devuelve `false` si no hubo forma de persistir. */
export async function saveState(json: string): Promise<boolean> {
  if (DESKTOP) {
    try {
      await invoke('state_save', { json })
      return true
    } catch {
      return false
    }
  }
  const ok = await idbSet(json)
  if (ok) return true
  try {
    window.localStorage.setItem(FALLBACK_KEY, json)
    return true
  } catch {
    return false
  }
}

export async function clearState(): Promise<void> {
  if (DESKTOP) {
    try {
      await invoke('state_clear')
    } catch {
      /* la app sigue siendo usable sin borrar */
    }
    return
  }
  await idbClear()
  try {
    window.localStorage.removeItem(FALLBACK_KEY)
  } catch {
    /* ignorado a propósito */
  }
}

// ── acciones del sistema ────────────────────────────────────────────────────

export async function openExternal(url: string): Promise<void> {
  if (DESKTOP) {
    try {
      await invoke('open_external', { url })
      return
    } catch {
      /* cae al navegador */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export interface NotifyPayload {
  title: string
  body: string
  /** Identificador para no repetir el aviso. */
  tag?: string
}

export async function notify(payload: NotifyPayload): Promise<void> {
  if (DESKTOP) {
    try {
      await invoke('notify', { title: payload.title, body: payload.body })
      return
    } catch {
      /* sigue por la vía web */
    }
  }
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      return
    }
  }
  if (Notification.permission === 'granted') {
    new Notification(payload.title, { body: payload.body, tag: payload.tag, silent: false })
  }
}

/** Guarda las credenciales de una fuente. En escritorio van al llavero del sistema. */
export async function storeSecret(key: string, value: string): Promise<boolean> {
  if (!DESKTOP) return false
  try {
    await invoke('secret_set', { key, value })
    return true
  } catch {
    return false
  }
}

export async function readSecret(key: string): Promise<string | null> {
  if (!DESKTOP) return null
  try {
    return await invoke<string | null>('secret_get', { key })
  } catch {
    return null
  }
}

/** Tamaño aproximado de lo guardado, para Ajustes. */
export async function storageUsage(): Promise<number> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate()
    return estimate.usage ?? 0
  }
  return 0
}

// ── red ─────────────────────────────────────────────────────────────────────

/**
 * `fetch` de la plataforma.
 *
 * En el navegador es el global. En el escritorio se usa el cliente del sistema,
 * que **no está sujeto a CORS**: es lo que permite leer Reddit, Mastodon y RSS,
 * que desde una página web son inalcanzables. Si el complemento no está
 * disponible, se cae al `fetch` normal en vez de romper la app.
 */
export async function platformFetch(): Promise<typeof fetch> {
  if (!DESKTOP) return globalThis.fetch.bind(globalThis)
  try {
    const mod = await import('@tauri-apps/plugin-http')
    return mod.fetch as unknown as typeof fetch
  } catch {
    return globalThis.fetch.bind(globalThis)
  }
}

// ── ventana (solo escritorio) ──────────────────────────────────────────────

/**
 * Asegura una ventana ancha al arrancar.
 *
 * Un lector de flujo necesita ancho: si la ventana viene estrecha, la aplicación
 * cae al modo compacto (barra inferior, sin contexto lateral) y todo se ve
 * ampliado. Si el escritorio no deja medir o maximizar, seguimos como estamos:
 * nunca es motivo para fallar el arranque.
 */
export async function ensureWideWindow(minLogicalWidth = 1100): Promise<boolean> {
  if (!DESKTOP) return false
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    if (await win.isMaximized()) return false
    const [size, factor] = await Promise.all([win.innerSize(), win.scaleFactor()])
    const logicalWidth = size.width / (factor || 1)
    if (logicalWidth >= minLogicalWidth) return false
    await win.maximize()
    return true
  } catch {
    return false
  }
}

// ── archivo SQLite (solo escritorio) ────────────────────────────────────────

export interface ArchiveStats {
  posts: number
  trends: number
  clusters: number
  bytes: number
  path: string
}

/**
 * Refleja en SQLite lo que el motor tiene en memoria. El archivo es la copia
 * duradera: se puede abrir con `sqlite3` y su índice FTS5 está siempre al día.
 */
export async function archiveSync(payload: unknown): Promise<ArchiveStats | null> {
  if (!DESKTOP) return null
  try {
    return await invoke<ArchiveStats>('archive_sync', { payload })
  } catch {
    return null
  }
}

export async function archiveStats(): Promise<ArchiveStats | null> {
  if (!DESKTOP) return null
  try {
    return await invoke<ArchiveStats>('archive_stats')
  } catch {
    return null
  }
}

export async function archiveExport(): Promise<string | null> {
  if (!DESKTOP) return null
  try {
    return await invoke<string>('archive_export')
  } catch {
    return null
  }
}

// ── sesión del navegador (solo escritorio) ─────────────────────────────────

/** Un perfil de navegador con sesión guardada, tal y como lo ve el escritorio. */
export interface BrowserProfile {
  kind: string
  label: string
  profile: string
  cookiesDb: string
  localState: string
  available: boolean
  detail: string | null
}

/** Lo que se sabe de una sesión importada. La cabecera `Cookie` no viaja aquí. */
export interface SessionSummary {
  domains: string[]
  names: string[]
  browser: string
  profile: string
  importedAt: number
}

/** Clave del secreto en el llavero. Una por fuente. */
export const sessionSecretKey = (key: string): string => `session.cookie.${key}`

/**
 * Navegadores y perfiles que se pueden leer en este equipo.
 *
 * Fuera del escritorio devuelve lista vacía: la sesión del navegador se lee con
 * el cliente nativo y no se finge que existe cuando no está.
 */
export async function sessionBrowsers(): Promise<BrowserProfile[]> {
  if (!DESKTOP) return []
  try {
    return await invoke<BrowserProfile[]>('session_browsers')
  } catch {
    return []
  }
}

/**
 * Importa las cookies de un perfil para los dominios indicados.
 *
 * Devuelve el error tal cual lo escribe el escritorio (en español y explicado)
 * en lugar de tragárselo: cuando la base de datos está bloqueada porque el
 * navegador sigue abierto, el usuario tiene que enterarse.
 */
export async function sessionImport(
  browser: string,
  profile: string,
  key: string,
  domains: string[],
): Promise<{ summary: SessionSummary | null; error: string | null }> {
  if (!DESKTOP) {
    return { summary: null, error: 'importar la sesión necesita la aplicación de escritorio' }
  }
  try {
    const summary = await invoke<SessionSummary>('session_import', { browser, profile, key, domains })
    return { summary, error: null }
  } catch (error) {
    return { summary: null, error: String(error) }
  }
}

/** Resumen de la sesión guardada, sin la cabecera. */
export async function sessionPeek(key: string): Promise<SessionSummary | null> {
  if (!DESKTOP) return null
  try {
    return await invoke<SessionSummary | null>('session_peek', { key })
  } catch {
    return null
  }
}

/**
 * Cabecera `Cookie` de la sesión importada, leída del llavero justo cuando hace
 * falta. Se queda en memoria el tiempo de la sesión de la app y no se escribe en
 * ningún sitio.
 */
export async function sessionHeader(key: string): Promise<string | null> {
  if (!DESKTOP) return null
  try {
    const serialized = await invoke<string | null>('secret_get', { key: sessionSecretKey(key) })
    if (!serialized) return null
    const parsed = JSON.parse(serialized) as { header?: string }
    return typeof parsed.header === 'string' && parsed.header.length > 0 ? parsed.header : null
  } catch {
    return null
  }
}

/** Olvida la sesión importada de una fuente. */
export async function sessionForget(key: string): Promise<boolean> {
  if (!DESKTOP) return false
  try {
    await invoke('session_forget', { key })
    return true
  } catch {
    return false
  }
}
