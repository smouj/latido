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
