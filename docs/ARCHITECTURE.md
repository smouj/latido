# Arquitectura

Latido es un lector local-first del pulso de internet. No hay cuentas, no hay
servidor propio y no hay base de datos central: la aplicación lee fuentes
públicas, normaliza lo que encuentra, agrupa lo que habla de lo mismo y calcula
si eso está creciendo.

## Capas

```text
  redes abiertas (HN · Bluesky/Jetstream · Reddit · Mastodon · RSS · GitHub)
        │
        │  1. conectores          packages/engine/src/sources/*.ts
        ▼     HTTP con User-Agent, límites de ritmo, reintentos
    RawItem[]                     contrato sucio: lo que devuelve cada red
        │
        │  2. normalización       packages/engine/src/normalize.ts
        ▼     URL canónica, idioma, entidades, simhash → Item
      Item                        modelo canónico único
        │
        │  3. agrupación          packages/engine/src/cluster.ts
        ▼     índice invertido doble → un tema por historia
     Cluster
        │
        │  4. almacén             store.ts (memoria) · store/schema.ts (SQLite)
        ▼
     MemoryStore / archive SQLite
        │
        │  5. tendencias          packages/engine/src/trend.ts
        ▼     ventana, línea base, score, estado, motivo
      Trend
        │
        │  6. avisos              packages/engine/src/alerts.ts
        ▼     reglas del usuario contra tendencias, con enfriamiento
    AlertEvent
        │
        │  7. aplicación          apps/app (React + Zustand)
        ▼     bridge.ts: única frontera con la plataforma
   interfaz  ·  escritorio (Tauri) o navegador
```

El motor (`packages/engine/src/engine.ts`) une las piezas 1–6 y no sabe nada de
la interfaz: recibe el almacén por inyección y devuelve resultados.

## Flujo de datos

1. **Sondeo.** `LatidoEngine.poll(kinds?, { limit })` selecciona las fuentes
   activas (`sourceConfigs.get(kind).enabled`) que además tengan conector
   registrado, y las lanza con `Promise.allSettled`. Un fallo de red no cancela
   el resto: el error se guarda en `IngestResult.errors` y en
   `SourceConfig.lastError`, y sale en la pantalla Fuentes.
2. **Descarga.** Cada conector recibe un `FetchContext` con `fetch` inyectado,
   `now`, `limit` y `log`, y devuelve `RawItem[]`. Todo el HTTP pasa por
   `httpText`/`httpJson`, que identifican la aplicación, respetan `Retry-After`
   y no se cuelgan (ver `docs/CONNECTORS.md`).
3. **Normalización.** `normalizeItem(raw, now, diccionario)` convierte cada
   `RawItem` en `Item`: canoniza la URL (fuera `utm_*`, `fbclid`…), detecta el
   idioma, extrae entidades del diccionario, calcula el `simhash` de 64 bits y
   fija un identificador estable `source:externalId`. Es una función pura: no
   toca red ni disco.
4. **Agrupación.** `Clusterer.assign(item, tokens)` busca candidatos en el
   índice invertido (token → temas) y en el índice de entidades, puntúa cada
   candidato y une el item al mejor si supera el umbral; si no, abre tema nuevo.
   `consolidate()` fusiona temas gemelos y retira los inactivos.
5. **Guardado.** `store.putItems(...)` inserta lo nuevo y, si el item ya
   existía, conserva la métrica más alta observada (nunca "des-aprende".
   `putClusters(...)` refleja los temas.
6. **Cálculo.** `recompute(now)` evalúa cada tema con `TrendEngine.evaluateAll`,
   guarda las tendencias, añade un punto a la serie temporal (un punto por
   minuto, `at = now - (now % 60_000)`) y lanza los avisos.
7. **Avisos.** `runAlerts(...)` evalúa las reglas contra las tendencias del
   ciclo, con enfriamiento por `regla::tema`, y guarda los eventos.
8. **Retención.** `retain(now)` borra lo más antiguo que `retentionMs`
   (30 días por defecto).
9. **Interfaz.** Si hay un oyente suscrito con `onUpdate`, el motor lo avisa al
   final del ciclo. La aplicación sincroniza su estado (Zustand) con
   `syncFromEngine()` y repinta.
10. **Persistencia.** La aplicación serializa `LatidoEngine.snapshot()`, un JSON
    con `SNAPSHOT_VERSION` 1, y lo escribe por `saveState()`: fichero de estado
    en el escritorio, IndexedDB (`latido` / `state` / `snapshot`) en el
    navegador, con `localStorage` como último recurso. Al arrancar,
    `hydrate(snapshot)` reconstruye almacén, temas y entidades.

## Por qué TypeScript en el motor y Rust solo en el shell

El motor es la parte difícil (agrupar, medir, explicar) y está escrita en
TypeScript puro, sin I/O implícito:

- **Una sola implementación.** El mismo código corre en Node (tests), en el
  navegador (modo web) y dentro del WebView de Tauri. Escribir el clustering en
  Rust obligaría a mantener dos versiones que pueden divergir en el resultado,
  justo donde el resultado es la funcionalidad.
- **Se puede probar sin nada.** Al inyectar `fetch`, `clock` y el almacén, los
  tests del motor no tocan la red ni el reloj real: los números del
  `docs/TREND-ENGINE.md` son reproducibles.
- **El hash no depende del entorno.** `fnv1a64` y `simhash` están escritos a
  mano con `BigInt`, así que el mismo texto da el mismo hash en Node, en el
  navegador y en cualquier otro sitio; no hay librería nativa de por medio.
- **Rust solo hace lo que el WebView no puede.** El shell (`apps/desktop`) se
  queda con: ventana y arranque de instancia única, notificaciones del sistema,
  abrir enlaces con el navegador del sistema, secretos en el llavero del sistema
  operativo y el archivo SQLite duradero. Nada de análisis.

## Paquetes

| Paquete | Ruta | Responsabilidad | Publicación |
| --- | --- | --- | --- |
| `@latido/engine` | `packages/engine` | Conectores, normalización, agrupación, tendencias, avisos y almacén en memoria. TypeScript puro, sin I/O implícito. | `private`, se consume desde fuente (`main`/`types` apuntan a `src/index.ts`) |
| `@latido/tokens` | `packages/tokens` | Fuente única del sistema de diseño. `src/tokens.mjs` → `dist/tokens.css` y `dist/tokens.json` con `scripts/build.mjs`. | `private`; se consume `dist/` |
| `@latido/app` | `apps/app` | Interfaz React 19 + Zustand 5 + Vite 6. La misma base para escritorio y navegador. | `private` |
| `@latido/desktop` | `apps/desktop` | Shell Tauri 2: ventana, llavero, notificaciones, enlaces y archivo SQLite. | `private` |

Raíz: `pnpm` con `packages/*`, `apps/app` y `apps/desktop` en el workspace
(`pnpm-workspace.yaml`). El alias `@latido/engine` apunta al TypeScript fuente
en `apps/app/vite.config.ts`, así que un error de tipos aparece donde se escribe
y no en un `dist` intermedio.

El contrato público del motor es `packages/engine/src/index.ts`: lo que no está
exportado ahí no es API.

## Superficie de la plataforma

`apps/app/src/platform/bridge.ts` es el único punto que pregunta por el entorno;
ningún componente comprueba "¿estoy en Tauri?". Decide con `isDesktop()`
(`'__TAURI_INTERNALS__' in window`) y ofrece:

| Función | Escritorio | Navegador |
| --- | --- | --- |
| `loadState` / `saveState` / `clearState` | `state_load`, `state_save`, `state_clear` | IndexedDB, con `localStorage` de reserva |
| `openExternal` | `open_external` (solo `http(s)`) | `window.open(..., 'noopener,noreferrer')` |
| `notify` | `notify` (notificación del sistema) | `Notification` del navegador |
| `storeSecret` / `readSecret` | `secret_set`, `secret_get` (llavero del sistema) | no disponible: devuelve `false` / `null` |
| `storageUsage` | `navigator.storage.estimate()` | igual |

Comandos que expone el shell: `state::state_load`, `state::state_save`,
`state::state_clear`, `archive::archive_sync`, `archive::archive_stats`,
`archive::archive_export`, `secrets::secret_set`, `secrets::secret_get`,
`secrets::secret_delete`, `notify` y `open_external`.

## Decisiones y alternativas descartadas

**Perfiles por red, sin reescritura en Rust.** Descartado: implementar el
clustering en Rust para acelerarlo. El coste real de Latido no es la CPU, son
las peticiones a las redes; duplicar el algoritmo habría costado divergencias
sin ganancia medible.

**Clustering incremental en vez de lotes.** Descartado: reentrenar o reasignar
todo el histórico cada ciclo (k-means, LDA, embeddings). El agrupador asigna en
tiempo constante respecto al histórico y nunca reetiqueta lo ya agrupado.

**Entidades al 35 % del peso.** Es un compromiso deliberado: dos historias
distintas de la misma empresa pueden caer en el mismo tema. A cambio, titulares
en idiomas distintos sobre el mismo asunto se agrupan, que es el objetivo. Los
temas muestran sus palabras clave para que el usuario vea de qué se habla.

**Simhash y FNV-1a propios.** Descartado: `crypto.subtle` (asíncrono y no
disponible en los tests) y librerías externas de hashing. 64 bits en `BigInt`
bastan para detectar duplicados casi idénticos y son idénticos en cualquier
entorno.

**Sin servidor, sin cuentas, sin telemetría.** Descartado: un backend que
agregue fuentes y sirva "lo que es tendencia". Un servidor tendría la clave de
API, la cuota y los términos de cada red, y convertiría una app local en un
servicio del que depende. Aquí cada instalación habla directo con las redes
abiertas.

**Estado en memoria + instantáneas.** Descartado: SQL en el navegador (sql.js,
wa-sqlite) para unificar el almacén. El navegador se queda con el
`MemoryStore` y una instantánea JSON; el escritorio usa SQLite de verdad, donde
tiene sentido (consultas, FTS5, archivos grandes).

**Tauri en lugar de Electron.** Descartado: Electron empaqueta Chromium entero
en cada instalación y multiplica el tamaño del binario sin aportar nada aquí; el
WebView del sistema ya es suficiente para la interfaz.

**X no se automatiza.** Descartado: leer X con scraping o con el flujo interno
del sitio. Se usa su API si algún día hay conector propio; fuera de la API, no.

**Conector `demo` determinista.** El PRNG xorshift32 con semilla fija produce
siempre el mismo día de actividad. Es lo que permite usar la app sin conexión,
tener capturas reproducibles y probar el clustering sin red.

## Diagnóstico

- `IngestResult` devuelve `fetched`, `inserted`, `duplicates`, `clustersTouched`,
  `trendsUpdated` y `errors` (con la fuente y el mensaje).
- `MemoryStore.stats()` resume items, temas, tendencias, avisos, número de
  fuentes y rango temporal; el escritorio tiene su equivalente en
  `archive_stats`.
- Cada `SourceConfig` lleva `lastOkAt` y `lastError`; la pantalla Fuentes los
  pinta junto al estado (activa/apagada, necesita proxy).
- El motor acepta un `log` inyectable que solo escribe si se le pasa; la app lo
  conecta a la consola en desarrollo.
