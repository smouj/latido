# Trend Engine

Dos piezas, dos preguntas distintas:

- **`Clusterer`** (`packages/engine/src/cluster.ts`): ¿estas publicaciones hablan
  de lo mismo?
- **`computeTrend`** (`packages/engine/src/trend.ts`): ¿esto está empezando a
  pasar?

Todo el cálculo es una función pura sobre los items del tema: mismo dato de
entrada, mismo resultado, sin red y sin reloj real.

## 1. Clusterer: agrupar sin reentrenar

Cada item que llega se asigna a un tema existente o abre uno nuevo.

### Índice invertido doble

- `token → temas`: se alimenta con las palabras clave de cada tema.
- `entidad → temas`: se alimenta con las entidades detectadas en cada tema.

En `candidates(tokens, now, entities)` se puntúa cada tema candidato: cada token
compartido suma 1 y cada entidad compartida suma 3 (una entidad compartida es
señal suficiente para ser candidato aunque no se comparta ni una palabra, que es
el caso de titulares en idiomas distintos). Se ordenan por esa puntuación, se
toman los **24 mejores** y se descartan los que llevan más de la ventana activa
sin actividad.

### Puntuación de similitud

```text
score = 0,40 · jaccard(tokens del item, keywords del tema)
      + 0,25 · simhashSimilarity(simhash del item, centroide del tema)
      + 0,35 · jaccard(entidades del item, entidades del tema)
```

`jaccard` es intersección sobre unión; `simhashSimilarity` es
`1 − hammingDistance / 64`. El item se une al mejor candidato si
`score ≥ 0,45`; si no, abre tema.

### Umbrales reales

| Parámetro | Valor | Significado |
| --- | --- | --- |
| `joinThreshold` | `0.45` | Similitud mínima para unirse a un tema existente |
| `mergeThreshold` | `0.62` | Similitud mínima para fusionar dos temas (`merge`) |
| `activeWindowMs` | `6 * 60 * 60 * 1000` (6 h) | Vida de un tema sin actividad nueva |
| `keywordLimit` | `8` | Máximo de palabras clave por tema |

### Detalles que importan

- **Identificador de tema:** `t<secuencia en base 36>-<6 primeros hex del simhash>`.
  Es estable dentro de una sesión de cálculo y no depende del reloj.
- **Palabras clave:** las 5 más repetidas de los tokens del item que creó el
  tema (`pickKeywords`), y se van mezclando con las de los items siguientes sin
  pasar de `keywordLimit`; nunca se descartan las que ya estaban.
- **Entidades del tema:** unión de las de sus items, recortada a 12.
- **Centroide:** votación por mayoría sobre los 64 bits. El tema guarda
  `bitCounts[64]` (cuántos de sus items tienen activado cada bit) y el centroide
  se recalcula: un bit queda a 1 si lo tiene **al menos la mitad** de los items
  (`bitCounts[bit] * 2 >= nº de items`). Al absorber un tema, los recuentos se
  suman. Así el centroide se mueve cuando llega información nueva, en vez de
  quedarse clavado en el primer item del tema.
- **Duplicados:** si el item ya está en el tema, no se añade: se incrementa
  `corroborations`.
- **Fusión (`merge`) y retirada (`evict`):** se ejecutan desde
  `LatidoEngine.consolidate()`, no en cada item.

### Título del tema

Un tema se llama por su **entidad** (`OpenAI`, `GTA VI`) o, si no tiene, por el
**titular del item más representativo** (el que más se parece a su centroide).
Concatenar palabras clave producía nombres ilegibles del estilo
«associate · become · canada»; el titular real de alguien se lee de un tirón y es
trazable hasta su origen.

### Qué llega al Radar

Solo los temas **con actividad en la ventana**: un tema cuyas publicaciones son
más viejas de 30 minutos no está creciendo, es una historia antigua, y aparecería
como «0 publicaciones». Además, tras cada recálculo se retiran los temas que se
quedaron sin publicaciones en el archivo (por retención o por caducidad), de modo
que los contadores no pueden decir que hay más temas que publicaciones.

## 2. computeTrend: medir si crece

### Ventanas

| Parámetro | Valor | Significado |
| --- | --- | --- |
| `windowMs` | `30 * 60 * 1000` | Ventana de análisis (30 min) |
| `bucketMs` | `2 * 60 * 1000` | Tamaño de cubo de la serie (2 min) |
| `buckets` | `15` | Cubos del sparkline (30 min en total) |
| `baselineMs` | `6 * 60 * 60 * 1000` | Histórico para la línea base (6 h) |

`bucketize` reparte los items de la ventana en 15 cubos de 2 minutos del más
antiguo al más nuevo. El índice se calcula **desde el ahora**
(`index = 15 − 1 − floor((now − publishedAt) / 2 min)`), así que un item
publicado en este mismo instante cae en el último cubo en lugar de quedarse
fuera de la serie. Lo que es más antiguo que la ventana se descarta; lo que
quede en el futuro (relojes desajustados) se acumula en el último cubo.

La serie se parte con `half = floor(15 / 2) = 7` y el corte es `slice(half)`:

- **reciente** = cubos 7–14 (los últimos 16 minutos).
- **anterior** = cubos 0–6 (los 14 minutos del principio).
- No hay ningún cubo sin contar: entre «anterior» y «reciente» no queda hueco.

### Métricas derivadas

```text
growth        = (reciente − anterior) / max(anterior, 1)
baselineRate  = items en (30 min, 6 h] / 165 cubos
recentRate    = reciente / 8
velocity      = recentRate / max(baselineRate, 0.25)
volume        = items dentro de la ventana de 30 min
coverage      = nº de redes distintas en la ventana
engagement    = suma ponderada de métricas (abajo)
novelty       = clamp01(1 − edad del tema / 6 h)
cohesion      = clamp01(1 − densidad de items por minuto / 12)
```

- `baselineBuckets = round((6 h − 30 min) / 2 min) = 165`.
- El suelo `0,25` en `baselineRate` evita divisiones por cero y acota la
  aceleración de un tema nuevo: sin histórico, `velocity = recentRate / 0,25`.
- **Engagement:** `likes + replies·2 + reposts·3 + comments·1,5 + stars·2 +
  score·0,5 + max(0, delta)·2`. Un repost vale más que un "me gusta" porque
  implica redistribución.
- **Cohesión:** con menos de 2 items es 1. Si no, mide la dispersión temporal:
  `items.length / max(span en minutos, 1)` dividido entre 12 y restado de 1, con
  recorte a `[0, 1]`.

### Score (0–100)

Normalizador logarítmico: `norm(valor, techo) = clamp01(ln(1 + valor) / ln(1 + techo))`.

```text
score = 100 · clamp01(
          0,34 · norm(volume, 300)
        + 0,30 · norm(velocity, 12)
        + 0,16 · clamp01((coverage − 1) / 4)
        + 0,12 · norm(engagement, 50000)
        + 0,08 · novelty
        )
```

Con `volume = 0` el score es 0, sin mirar nada más: un tema vacío no puntúa por
ser nuevo. Con `coverage ≥ 5` la cobertura ya satura (el término llega a 1).

### Estados

Se evalúan en este orden y gana el primero que se cumple:

| Estado | Condición |
| --- | --- |
| `breaking` | `coverage ≥ 3` y `velocity ≥ 5` y `volume ≥ 25` |
| `emerging` | `velocity ≥ 2,5` y `volume ≥ 8` y `antigüedad ≤ 90 min` |
| `rising` | `velocity ≥ 1,6` |
| `fading` | `velocity < 0,6` y `antigüedad > 30 min` |
| `quiet` | todo lo demás |

`antigüedad = (now − cluster.firstSeen) / 60000`, en minutos.

### Motivos

`reasonOf` devuelve el primer código que encaja, con el mismo orden:

| Código | Condición |
| --- | --- |
| `multi_source` | `coverage ≥ 3` y `velocity ≥ 2,5` |
| `velocity_spike` | `velocity ≥ 3` |
| `new_topic` | `antigüedad ≤ 20 min` y `volume ≥ 5` |
| `sustained` | resto |

`params` lleva siempre `velocity` (redondeado a 1 decimal), `growth` (en %,
entero), `sources` (la cobertura), `volume` y `windowMin` (30). La interfaz
traduce el código con `reason.*` en `apps/app/src/i18n/index.ts`.

`project_velocity` existe en el tipo `TrendReason` y tiene texto en la interfaz,
pero `computeTrend` no lo genera: procede de las reglas de aviso de proyecto.
Tampoco se genera `reason.project_velocity` desde el motor de tendencias.

### Título y muestra

- Si el tema tiene entidades con nombre conocido (`entityNames`), el título son
  las dos primeras unidas por ` · `; si no, `titleFromKeywords` con las tres
  primeras palabras clave en mayúscula inicial.
- `sampleIds` son los 8 items más recientes de la ventana, para "Ver
  conversación".

### TrendEngine (con memoria)

`TrendEngine` guarda la última foto (`score`, `velocity`, `at`) de cada tema:

- `evaluate(...)` delega en `computeTrend` y actualiza la foto.
- `evaluateAll(...)` evalúa y ordena por `score` descendente, con `volume` como
  desempate.
- `escalated(trend)` es `true` si no había foto previa y el estado no es
  `quiet`, o si `velocity ≥ anterior · 1,5` y `score ≥ anterior + 5`.

Esa foto es lo que evita que un pico puntual vuelva a disparar los mismos
avisos, que además tienen su propio enfriamiento por regla y tema.

## Ejemplo numérico paso a paso

Escenario: un tema sobre OpenAI con 28 minutos de vida, movimiento reciente y
sin historia anterior. Los valores están **calculados con el código real**
(`computeTrend` con las opciones por defecto); no están escritos a mano.

**Entrada**

- `now = T`, `cluster.firstSeen = T − 28 min`, `lastSeen = T`.
- 16 items dentro de la ventana de 30 minutos, en estos minutos atrás:
  `28, 26, 24, 22, 20, 18, 12, 11, 8, 8, 6, 5, 4, 3, 2, 1`.
- 3 redes: `bluesky`, `reddit`, `hackernews`, alternándose.
- Sin métricas de interacción (los items de ejemplo no traen `likes`).

**Paso 1 — serie:** `bucketize` da
`[1,1,1,1,1,1,0,0,1,1,2,1,2,2,1]` (suma 16).

**Paso 2 — mitades:** `reciente = 10` (cubos 7–14), `anterior = 6` (cubos 0–6).

**Paso 3 — crecimiento:** `growth = (10 − 6) / 6 = 0,6667` → `0.667` (+67 %).

**Paso 4 — línea base y aceleración:**

- No hay items entre 30 min y 6 h: `baselineRate = 0`, así que el suelo manda.
- `recentRate = 10 / 8 = 1,25` items por cubo.
- `velocity = 1,25 / max(0; 0,25) = 5`.

**Paso 5 — resto de señales:**

- `volume = 16`, `coverage = 3`.
- `engagement = 0` (sin métricas en la entrada).
- `novelty = clamp01(1 − 28/360) = 0,9222`.
- `cohesion`: 16 items en 28 minutos → densidad 0,571 → `1 − 0,571/12 = 0,952`.

**Paso 6 — score:** con `norm(16, 300) = ln(17)/ln(301) = 0,4964`,
`norm(5, 12) = ln(6)/ln(13) = 0,6986`, `(3 − 1)/4 = 0,5` y el término de
interacción a cero:

```text
0,34·0,4964 + 0,30·0,6986 + 0,16·0,5 + 0,12·0 + 0,08·0,9222
= 0,1688 + 0,2096 + 0,0800 + 0 + 0,0738 = 0,5322
score = round(100 · 0,5322) = 53
```

**Paso 7 — estado:** `coverage 3 ≥ 3` y `velocity 5 ≥ 5`, pero `volume 16 < 25`,
así que no es `breaking`; `velocity 5 ≥ 2,5`, `volume 16 ≥ 8` y antigüedad
28 ≤ 90 → **`emerging`**.

**Paso 8 — motivo:** `coverage ≥ 3` y `velocity ≥ 2,5` → **`multi_source`**.

**Resultado** (el resto de campos los devuelve el motor: `sparkline`, `sources`,
`sampleIds`, `acknowledged`):

```json
{
  "title": "OpenAI",
  "score": 53,
  "state": "emerging",
  "velocity": 5,
  "growth": 0.667,
  "volume": 16,
  "coverage": 3,
  "engagement": 0,
  "novelty": 0.92,
  "cohesion": 0.95,
  "sparkline": [1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 2, 1, 2, 2, 1],
  "sources": [
    { "source": "bluesky", "count": 6, "share": 0.375 },
    { "source": "hackernews", "count": 5, "share": 0.3125 },
    { "source": "reddit", "count": 5, "share": 0.3125 }
  ],
  "reason": {
    "code": "multi_source",
    "params": { "velocity": 5, "growth": 67, "sources": 3, "volume": 16, "windowMin": 30 }
  }
}
```

Este caso enseña lo que el pulso **no** premia: un tema con buena aceleración y
presencia en tres redes, pero sin interacción y con poco volumen, se queda en 53.
Para llegar a `breaking` hacen falta 25 publicaciones además de las tres redes y
la aceleración.

## Series temporales

`LatidoEngine.recompute(now)` guarda un punto por minuto y tema, con
`at = now − (now % 60_000)`, y `volume`, `score` y `velocity` de ese instante. En
memoria se conservan los últimos 720 puntos por tema (12 horas a un punto por
minuto). En SQLite viven en `trend_points`, con clave primaria `(trend_id, at)`.

## Avisos sobre tendencias

`evaluateAlerts` (`packages/engine/src/alerts.ts`) cruza reglas y tendencias:

1. Descarta reglas desactivadas.
2. Por cada tendencia: `growth ≥ minGrowth`, `coverage ≥ minSources`,
   filtro de fuentes si la regla lo pide, y después la condición del tipo
   (`multi_source`, `global_breaking`, `topic_surge`, `watched_entity`,
   `keyword`, `project_velocity`).
3. Comprueba el enfriamiento con la clave `regla::tema` y la marca.
4. Emite un `AlertEvent` con la instantánea mínima (score, velocity, growth,
   coverage, volume, sources) para poder pintarlo aunque el tema ya haya
   caducado.

Reglas por defecto (`DEFAULT_RULES`):

| Tipo | Estado | Crecimiento mínimo | Redes mínimas | Enfriamiento |
| --- | --- | --- | --- | --- |
| `multi_source` | activa | 2,5 | 3 | 45 min |
| `global_breaking` | activa | 4 | 4 | 30 min |
| `project_velocity` | desactivada | 0,8 | 1 | 6 h |

`pruneFired` olvida el estado de enfriamiento de más de 24 horas, para que el
mapa no crezca sin límite.
