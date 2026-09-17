# Conectores

Un conector traduce una red a `RawItem[]`. Nada más: no agrupa, no guarda, no
decide. El motor se encarga del resto, así que añadir una red no cambia el
núcleo ni la interfaz.

Están en `packages/engine/src/sources/` y se registran en
`packages/engine/src/sources/index.ts`.

## La interfaz `Connector`

```ts
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
```

- `kind` tiene que existir en la unión `SourceKind`
  (`packages/engine/src/types.ts`).
- `options` es lo único que hace falta declarar para que la pantalla Fuentes
  genere el formulario: cada entrada se convierte en un campo de texto con su
  etiqueta y su marcador.
- Lo que el conector escriba en las opciones se lee con `optionList(config, key,
  fallback)` (acepta `string` con comas o `string[]`) y `optionNumber(config,
  key, fallback)`.
- `fetchItems` recibe `SourceConfig` (qué pidió el usuario) y `FetchContext`
  (con qué puede trabajar).

### `FetchContext`

```ts
export interface FetchContext {
  fetch: typeof fetch   // inyectado: en Node el global; en escritorio, un proxy sin CORS
  now: number
  limit?: number
  signal?: AbortSignal
  log?: (message: string) => void   // traza que la app muestra en Fuentes
}
```

El conector **nunca** llama a `fetch` global ni a `Date.now()`: usa `ctx.fetch` y
`ctx.now`. Es lo que permite probarlo con un `fetch` falso y un reloj fijo.

### `RawItem`

El contrato de entrada, deliberadamente tolerante con lo que devuelve cada red:

```ts
export interface RawItem {
  source: SourceKind
  externalId: string
  url: string
  title?: string
  body?: string
  lang?: string
  author?: Partial<Author> & { handle?: string }
  publishedAt?: number      // epoch ms
  metrics?: ItemMetrics     // likes, replies, reposts, comments, stars, score, delta
  tags?: string[]
  origin: string            // la URL exacta que se pidió: para depurar el conector
}
```

La normalización (`normalizeItem`) se encarga de lo demás: canoniza la URL,
rellena el autor ausente, detecta el idioma si no viene, extrae entidades y
calcula el `simhash`. Por eso un conector puede devolver lo mínimo y seguir
funcionando.

`origin` es obligatorio a propósito: cuando algo sale mal, se ve qué se pidió.

## HTTP: `httpText` / `httpJson`

Todo el tráfico pasa por `packages/engine/src/sources/http.ts`:

- **User-Agent propio:** `Latido/0.1 (+https://github.com/smouj/latido; local-first reader)`.
- **Tiempo máximo:** 12 s por intento (`DEFAULT_TIMEOUT`).
- **Reintentos:** 2 (`MAX_RETRIES`), con espera creciente. En `429`/`503` se
  respeta `Retry-After` (hasta 15 s); si no lo trae, espera `800 ms · intento`.
  Otros fallos esperan `400 ms · intento`.
- **Errores:** se lanzan como `SourceError` con la fuente y, si aplica, el
  código HTTP. El motor los captura por fuente y sigue con las demás.
- **Cancelación:** `AbortSignal` del contexto, respetado por intento.

`RateLimiter` (`new RateLimiter(intervalMs)` + `await take(key)`) está disponible
para espaciar peticiones de una misma clave; hoy los conectores incluidos no lo
usan, porque el espaciado lo marca la periodicidad del sondeo.

### Cadencia real de sondeo

- La aplicación (`apps/app/src/App.tsx`) programa un ciclo cada
  `max(60 s, min(pollMs de las fuentes activas, 300 s))`, además de un ciclo al
  volver a la ventana. `defaultSourceConfigs()` no fija `pollMs`, así que en la
  práctica son 5 minutos.
- `Connector.defaultPollMs` es el ritmo recomendado de cada red y se muestra en
  la pantalla Fuentes; no programa nada por sí solo (`@latido/engine` lo usa el
  motor al informar, no al sondear).
- Reddit es la excepción con más disciplina: sondeo cada 5 minutos y OAuth
  opcional para subir el límite.

## Fuentes incluidas

| Fuente | `defaultPollMs` | Proxy | Endpoint | Opciones (por defecto) |
| --- | --- | --- | --- | --- |
| Hacker News | 3 min | no | `https://hacker-news.firebaseio.com/v0` (API oficial de Firebase, sin clave y con CORS abierto) | `lists` (`topstories,beststories`), `limit` (30) |
| Bluesky | 2 min | no | `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts` + Jetstream | `queries` (vacío), `limit` (25) |
| Reddit | 5 min | sí | `https://www.reddit.com/r/<sub>/<sort>.json` o `https://oauth.reddit.com` con token | `subreddits` (`technology,programming`), `sort` (`new`), `limit` (25), `token` |
| Mastodon | 5 min | sí | `https://<instancia>/api/v1/timelines/tag/<etiqueta>` | `instances` (`mastodon.social`), `tags` (vacío), `limit` (20) |
| RSS / Atom | 10 min | sí | los feeds que indique el usuario | `feeds` (vacío) |
| GitHub | 8 min | no | `https://api.github.com/search/repositories`, `/repos/<owner>/<repo>/releases` | `queries` (`stars:>200`), `sinceDays` (7), `repos` (vacío), `limit` (20), `token` |
| Ejemplo | 30 min | no | nada: genera un día de actividad con semilla fija | `seed` (`20260917`) |

Notas de implementación que conviene no romper:

- **Hacker News:** descarga las listas, une ids sin repetir, corta a `limit` y
  pide los items con **concurrencia 6** (`mapWithConcurrency`). Descarta
  `deleted`/`dead` y deja pasar `story` y `job`. Los comentarios llegan en HTML:
  `stripHtml` los limpia sin dependencias.
- **Bluesky:** sin `queries` no pide nada (devuelve lista vacía). El flujo en
  tiempo real (`BlueskyStream`) se conecta a
  `wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post`,
  reconecta con espera exponencial (`min(1000 · 2^intento, 60 s)`, intento
  máximo 6), descarta textos de menos de 12 caracteres y resuelve
  DID → handle con caché en memoria. Nunca lanza: un corte de red se reintenta.
- **Reddit:** se usa el endpoint público de lectura ligera. Reddit **exige**
  identificarse con un User-Agent propio (lo pone `httpText`) y limita el ritmo;
  el sondeo es más lento y `requiresProxy` está a `true` porque la API no manda
  cabeceras CORS. Filtra contenido `over_18`. Con `token` (OAuth) el límite sube.
- **Mastodon:** cada instancia es un mundo: instancias y etiquetas se combinan
  (máximo 6 instancias × 8 etiquetas). Sin etiquetas no pide nada.
- **RSS/Atom:** hasta 24 feeds por ciclo, `accept` de XML, parseo con
  `fast-xml-parser` (exportado como `parseFeed` para poder probarlo con XML
  enlatado). Acepta RSS (`channel/item`) y Atom (`feed/entry`).
- **GitHub:** busca repos recién creados
  (`<query> created:><fecha>`, orden por estrellas) y releases de los repos
  vigilados (3 por repo, sin pre-releases). Sin token la API permite 10
  peticiones por minuto; con `token`, 30.
- **Ejemplo:** `demoRawItems` usa un PRNG xorshift32 con semilla fija: el mismo
  día de actividad cada vez. Es lo que permite usar la app sin conexión y tener
  capturas y tests reproducibles.
- **`youtube` y `lemmy`** existen en el tipo `SourceKind` y en el registro, pero
  apuntan al conector de ejemplo: están anunciados en la carretera, no en la
  interfaz.

## Respeto a los términos de cada red

- **Solo interfaces públicas y documentadas.** HN (API oficial), Bluesky (XRPC
  público y Jetstream), GitHub (API pública), Mastodon (API pública de cada
  instancia), Reddit (`/<sub>/new.json`, permitido para lectura ligera) y RSS
  (los feeds que el usuario elige).
- **Identificación.** Todas las peticiones llevan el User-Agent de Latido con la
  URL del proyecto. Reddit y GitHub lo exigen; las demás también lo agradecen.
- **Límites de ritmo.** Se respeta `Retry-After` y se espacian los sondeos según
  `defaultPollMs`; el orden de magnitud es de minutos, no de segundos. Con OAuth
  o token se respeta igual: el límite es del usuario, no de Latido.
- **Sin credenciales por defecto.** Hacker News, Bluesky y GitHub funcionan sin
  clave. Reddit y GitHub admiten un token opcional, guardado en el llavero del
  sistema (`storeSecret`) y nunca en el repositorio ni en la instantánea.
- **X (Twitter) no se automatiza fuera de su API.** No hay conector y no se
  añadirá por scraping del sitio ni por sus endpoints internos: además de
  frágil, va contra sus condiciones. Si algún día hay conector, usará la API con
  credenciales del usuario.
- **Nada de contenido privado.** Los conectores leen lo que ya es público.

## Receta: añadir una fuente nueva

Caso concreto: una red "Ejemplo Social" con `kind: 'ejemplo'`.

1. **Tipo.** Añade `'ejemplo'` a la unión `SourceKind` en
   `packages/engine/src/types.ts`.
2. **Conector.** Crea `packages/engine/src/sources/ejemplo.ts`:

   ```ts
   import type { RawItem } from '../normalize'
   import { httpJson } from './http'
   import { optionList, optionNumber, type Connector, type FetchContext } from './types'

   interface Post { id: string; url: string; text: string; at: number; user: string }

   export const ejemploConnector: Connector = {
     kind: 'ejemplo',
     label: 'Ejemplo Social',
     requiresProxy: false,          // true si el navegador no puede llamarla
     defaultPollMs: 4 * 60 * 1000,
     options: [
       { key: 'queries', label: 'Búsquedas', placeholder: 'openai, rust', defaultValue: '' },
       { key: 'limit', label: 'Máximo por ciclo', placeholder: '20', defaultValue: '20' },
     ],
     async fetchItems(config, ctx: FetchContext): Promise<RawItem[]> {
       const queries = optionList(config, 'queries')
       const limit = Math.min(optionNumber(config, 'limit', 20), ctx.limit ?? 20)
       if (queries.length === 0) return []

       const results = await Promise.all(
         queries.slice(0, 8).map(async (query) => {
           const url = `https://api.ejemplo.social/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`
           try {
             const posts = await httpJson<Post[]>(ctx, url, { source: 'ejemplo' })
             return posts.map<RawItem>((post) => ({
               source: 'ejemplo',
               externalId: post.id,
               url: post.url,
               body: post.text.slice(0, 1000),
               author: { handle: post.user, url: `https://ejemplo.social/@${post.user}` },
               publishedAt: post.at * 1000,
               tags: ['ejemplo'],
               origin: url,
             }))
           } catch (error) {
             ctx.log?.(`Ejemplo Social "${query}": ${(error as Error).message}`)
             return [] as RawItem[]
           }
         }),
       )
       return results.flat()
     },
   }
   ```

   Reglas de la casa: usar `httpJson`/`httpText` (nunca `fetch` a pelo), no
   lanzar por una consulta concreta (se registra con `ctx.log` y se devuelve
   lista vacía), respetar `ctx.limit` y rellenar `origin`.
3. **Registro.** En `packages/engine/src/sources/index.ts`, impórtalo, añádelo a
   `CONNECTORS` y a `defaultSourceConfigs()` con su `enabled`, `options` y, si
   procede, `requiresProxy`. Expórtalo también en la línea final de reexportados.
4. **Pruebas.** Añade un caso en `packages/engine/tests/` con un `fetch` falso
   (mira `engine.test.ts`, donde un fallo de red no tumba el ciclo) y, si
   parseas algo propio, exporta la función de parseo para probarla con datos
   enlatados, como `parseFeed`.
5. **Documentación.** Añade la fila a la tabla de fuentes de este documento y,
   si toca privacidad, actualiza `docs/PRIVACY.md`. Si el conector tiene textos
   de interfaz nuevos, añádelos en `apps/app/src/i18n/index.ts` en los dos
   idiomas.
6. **Comprueba.** `pnpm test`, `pnpm typecheck` y `pnpm verify`. Si la red
   necesita proxy, verifica además que la pantalla Fuentes lo dice
   (`requiresProxy` la pinta como "necesita el escritorio" cuando no lo hay).

## CORS: qué funciona dónde

Comprobado a base de golpes contra la aplicación en marcha, no supuesto:

| Petición | Navegador | Escritorio |
| --- | --- | --- |
| Hacker News (Firebase) | sí | sí |
| GitHub (`api.github.com`) | sí | sí |
| Bluesky **Jetstream** (WebSocket) | sí | sí |
| Bluesky búsqueda (`public.api.bsky.app`) | **no** (sin cabeceras CORS) | sí |
| Reddit | **no** | sí |
| Mastodon (instancias) | **no** | sí |
| RSS / Atom | **no** (casi ningún medio manda CORS) | sí |

Los WebSocket no están sujetos a CORS, y por eso el **flujo en directo funciona
también en el navegador**, mientras que las búsquedas por API necesitan el
escritorio. En la interfaz esto se ve en la pantalla de Fuentes: cada fuente dice
si necesita el escritorio y no se queda en silencio cuando falla.
