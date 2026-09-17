# Modelo de datos

Dos implementaciones del mismo modelo:

- **En disco (escritorio):** SQLite, con el esquema de
  `packages/engine/src/store/schema.ts` (`SCHEMA_SQL`, `SCHEMA_VERSION = 1`) y su
  espejo Rust `apps/desktop/src-tauri/src/schema.sql`, que el shell aplica con
  `execute_batch` al abrir el archivo. Los dos archivos describen el mismo
  modelo y **deben cambiar juntos**; si sube `SCHEMA_VERSION`, hay que añadir la
  migración en `MIGRATIONS` y en el lado Rust.
- **En memoria (navegador y tests):** `MemoryStore`
  (`packages/engine/src/store.ts`), con la misma forma de datos y una
  instantánea JSON serializable (`StoreSnapshot`, `SNAPSHOT_VERSION = 1`).

Convenciones del esquema:

- Los identificadores son texto y son **deterministas**: un item es
  `source:externalId`; un tema, `t<secuencia base 36>-<6 hex de simhash>`.
- Los tiempos son enteros `epoch ms` (`published_at`, `ingested_at`,
  `created_at`, `last_seen`, `at`, `updated_at`).
- Los conjuntos y objetos van en columnas `*_json` con JSON en texto.
- Las banderas booleanas son enteros `0`/`1`.

## Tablas

### `meta`

Clave-valor del propio archivo. `key` (PK), `value`.

### `sources`

Configuración y estado de cada fuente.

| Columna | Tipo | Notas |
| --- | --- | --- |
| `kind` | TEXT PK | `SourceKind`: `hackernews`, `bluesky`, `reddit`, `mastodon`, `rss`, `github`, `demo`, `youtube`, `lemmy` |
| `enabled` | INTEGER | 1 por defecto |
| `options_json` | TEXT | Parámetros propios (subreddits, feeds, instancias, términos…) |
| `requires_proxy` | INTEGER | 1 si el navegador no puede llamarla directamente |
| `poll_ms` | INTEGER | Ritmo máximo de sondeo |
| `last_ok_at` | INTEGER | Última respuesta correcta |
| `last_error` | TEXT | Último error, tal cual, para la pantalla Fuentes |

### `posts`

Los items normalizados. Una fila por publicación.

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | TEXT PK | `source:externalId` |
| `source` | TEXT | Red de origen |
| `external_id` | TEXT | Identificador dentro de la red |
| `url` | TEXT | URL ya canonizada |
| `title`, `body`, `lang` | TEXT | Texto e idioma detectado (`es`, `en`, `und`) |
| `author_id`, `author_handle`, `author_name` | TEXT | Autor normalizado |
| `published_at` | INTEGER | Cuándo lo publicó la fuente |
| `ingested_at` | INTEGER | Cuándo lo vio Latido |
| `likes`, `replies`, `reposts`, `comments`, `stars`, `score`, `delta` | INTEGER | Métricas; `delta` es la variación desde la observación anterior |
| `tags_json` | TEXT | Etiquetas normalizadas, ordenadas |
| `entities_json` | TEXT | Slugs de entidades detectadas |
| `cluster_id` | TEXT | Tema al que se asignó |
| `simhash` | TEXT | Huella de 64 bits en hex |
| `origin` | TEXT | Qué pedía exactamente la fuente (depuración del conector) |
| `read` | INTEGER | Leído por el usuario |

Índices: `idx_posts_published` (`published_at DESC`), `idx_posts_cluster`
(`cluster_id`), `idx_posts_source` (`source, published_at DESC`) y el único
`idx_posts_external` (`source, external_id`) — este último es el que hace
imposible duplicar un item.

En memoria, `read` no vive en el item: se guarda como conjunto aparte y se
persiste dentro de la sesión (`SessionState.readIds`).

### `clusters`

Temas activos o recientes: `id` (PK), `keywords_json`, `entities_json`,
`centroid`, `first_seen`, `last_seen`, `corroborations` (items descartados por
duplicado casi exacto), `lang`. Índice: `idx_clusters_last_seen`
(`last_seen DESC`).

### `cluster_sources`

Relación N:M entre temas y redes: `cluster_id` (FK a `clusters.id`, borrado en
cascada), `source`, PK compuesta `(cluster_id, source)`. Es lo que permite
responder "cuántas redes hablan de esto" sin recorrer los items.

### `trends`

La foto más reciente de cada tema.

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | TEXT PK | Identificador del tema |
| `title` | TEXT | Nombre legible |
| `state` | TEXT | `quiet`, `rising`, `emerging`, `breaking`, `fading` |
| `score` | INTEGER | 0–100, orden por defecto del Radar |
| `velocity`, `growth` | REAL | Aceleración y variación de la última ventana |
| `volume`, `coverage`, `engagement` | INTEGER | Publicaciones, redes, interacción |
| `novelty`, `cohesion` | REAL | 0–1 |
| `first_seen`, `last_seen` | INTEGER | Vida del tema |
| `reason_code`, `reason_json` | TEXT | Motivo estructurado; la interfaz lo traduce |
| `updated_at` | INTEGER | Última evaluación |
| `acknowledged` | INTEGER | Ya visto por el usuario |

Índice: `idx_trends_score` (`score DESC, last_seen DESC`).

### `trend_points`

Serie temporal por tema: `trend_id` (FK a `trends.id`, cascada), `at`, `score`,
`volume`, `velocity`; PK compuesta `(trend_id, at)`. El motor escribe un punto
por minuto.

### `entities`

Diccionario de entidades y estado de vigilancia: `slug` (PK), `name`, `kind`
(`person`, `org`, `project`, `topic`, `place`), `aliases_json`,
`accounts_json` (cuentas por red, para Seguir), `links_json` (feeds y repos
asociados), `watch`.

### `watchlists`

Listas de seguimiento guardadas: `id` (PK), `name`, `entities_json`,
`keywords_json`, `created_at`.

### `alert_rules`

Reglas de aviso: `id` (PK), `kind` (`topic_surge`, `multi_source`,
`watched_entity`, `keyword`, `global_breaking`, `project_velocity`), `enabled`,
`query`, `min_growth`, `min_sources`, `sources_json`, `cooldown_ms`,
`created_at`.

### `alert_events`

Avisos disparados: `id` (PK), `rule_id`, `kind`, `trend_id`, `title`,
`snapshot_json` (score, velocity, growth, coverage, volume y reparto por red en
el momento del aviso), `created_at`, `read`. Índice:
`idx_alert_events_created` (`created_at DESC`).

### `alert_fired`

Estado de enfriamiento entre ciclos: `key` (PK) con el formato `regla::tema` y
`at`. `pruneFired` mantiene solo las últimas 24 horas.

### `user_lists`

Listas propias del usuario: `id` (PK), `name`, `members_json` (slugs o
`source:id` de autores), `created_at`.

### `bookmarks`

`post_id` (PK, FK a `posts.id`, borrado en cascada), `created_at`.

### `kv`

Clave-valor general de la aplicación: `key` (PK), `value`.

## Búsqueda de texto completo

```sql
CREATE VIRTUAL TABLE posts_fts USING fts5 (
  title, body, tags,
  content = 'posts',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);
```

Es una tabla externa (`content = 'posts'`): no guarda copia de los datos, sino el
índice, y apunta a la fila real por `rowid`. El tokenizador `unicode61` con
`remove_diacritics 2` hace que "latido" encuentre "latído" y "latidos".

El índice lo mantienen **tres disparadores**, no el código:

| Disparador | Cuándo | Qué hace |
| --- | --- | --- |
| `posts_ai` | `AFTER INSERT ON posts` | Inserta la fila en `posts_fts` |
| `posts_ad` | `AFTER DELETE ON posts` | Marca el borrado (`'delete'`) |
| `posts_au` | `AFTER UPDATE ON posts` | Borra la versión antigua e inserta la nueva |

Al ser disparadores, cualquiera que escriba en `posts` — incluida una sesión de
`sqlite3` a mano — deja el índice correcto. En memoria, el equivalente es el
índice invertido `searchIndex` de `MemoryStore`, alimentado en `putItems` y
podado en `prune`; la consulta usa las mismas reglas de normalización
(`normalizeText`: sin acentos, sin mayúsculas) mediante `searchItems`.

## Relaciones

```text
clusters 1 ──── N cluster_sources
clusters 1 ──── N posts            (posts.cluster_id, sin FK declarada)
trends   1 ──── 1 clusters          (mismo id: el tema es la unidad)
trends   1 ──── N trend_points     (cascada)
posts    1 ──── N bookmarks        (cascada)
alert_rules 1 ── N alert_events    (alert_events.rule_id, histórico)
alert_events N ── 1 trends         (alert_events.trend_id)
```

`cluster_sources`, `trend_points` y `bookmarks` declaran `REFERENCES ... ON
DELETE CASCADE`; `posts.cluster_id` no lleva clave foránea a propósito, porque un
item debe sobrevivir a la retirada del tema al que se asignó.

## Política de retención

- **Motor (memoria):** `LatidoEngine` usa `retentionMs` con 30 días por defecto
  (`30 * 86_400_000`). `retain(now)` llama a `MemoryStore.prune(now − retentionMs)`,
  que borra los items con `published_at` anterior al corte y, además, las
  tendencias ya caducadas **solo si están reconocidas** (`acknowledged`): una
  tendencia sin leer no se borra hasta que el usuario la ve.
- **Aplicación:** Ajustes ofrece "Conservar publicaciones" con 30 días por
  defecto y la opción "Siempre" (`retentionDays: 0`), que desactiva la poda.
- **SQLite:** la retención se aplica con las mismas dos sentencias, documentadas
  en el propio esquema:

  ```sql
  DELETE FROM posts  WHERE published_at < ?;
  DELETE FROM trends WHERE last_seen < ? AND acknowledged = 1;
  ```

  Las filas de `posts_fts` se van solas con `posts_ad`; los `trend_points` de un
  tema borrado caen en cascada.
- **Series:** en memoria se conservan los últimos 720 puntos por tema. En
  SQLite no hay poda propia de `trend_points`: se van con su tema.
- **Borrado total:** Ajustes → "Borrar todo lo guardado" llama a `clearState()`
  (fichero de estado o IndexedDB). Es la vía para dejar el dispositivo como
  recién instalado; ver `docs/PRIVACY.md`.

## Instantánea en memoria (`StoreSnapshot`)

`SNAPSHOT_VERSION = 1` y el objeto lleva: `items`, `clusters`, `trends`,
`points`, `alerts`, `rules`, `fired`, `entities`, `watchlists`, `lists`,
`bookmarks`, `kv`, `session` y `savedAt`. Al hidratar, `MemoryStore.hydrate`
reconstruye los mapas y el índice de búsqueda, y `LatidoEngine.hydrate` vuelve a
sembrar las entidades del diccionario y reasigna cada item a su tema para que el
agrupador y el almacén no se desincronicen.
