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
- **Centroide:** `blendCentroid` pretende ser una media por bits, ponderando el
  valor anterior con `weight = min(nº de items, 32)` y añadiendo 1 si el bit
  entrante está a 1; el bit queda a 1 si `voto + entrante > weight / 2`.
  En la práctica, con `weight ≥ 2` ningún bit puede activarse (1 no supera a
  `weight / 2`) y ningún bit activo puede apagarse, así que el centroide
  converge al OR de los simhash de los dos primeros items y después se queda
  quieto. Está documentado en `docs/CONTRIBUTING.md` como comportamiento
  conocido a corregir; no se toca aquí porque afecta al agrupado.
- **Duplicados:** si el item ya está en el tema, no se añade: se incrementa
  `corroborations`.
- **Fusión (`merge`) y retirada (`evict`):** se ejecutan desde
  `LatidoEngine.consolidate()`, no en cada item.

## 2. computeTrend: medir si crece

### Ventanas

| Parámetro | Valor | Significado |
| --- | --- | --- |
| `windowMs` | `30 * 60 * 1000` | Ventana de análisis (30 min) |
| `bucketMs` | `2 * 60 * 1000` | Tamaño de cubo de la serie (2 min) |
| `buckets` | `15` | Cubos del sparkline (30 min en total) |
| `baselineMs` | `6 * 60 * 60 * 1000` | Histórico para la línea base (6 h) |

`bucketize` reparte los items de la ventana en 15 cubos de 2 minutos del más
antiguo al más nuevo. Un item entra si
`0 ≤ floor((publishedAt − start) / bucketMs) < 15`, con `start = now − 30 min`;
por tanto el cubo es semiabierto: un item publicado exactamente en `now` queda
fuera de la serie (y sí cuenta en `volume`).

La serie se parte por la mitad (`half = floor(15 / 2) = 7`):

- **reciente** = cubos 8–14 (los últimos 14 minutos).
- **anterior** = cubos 0–6 (los 14 minutos del principio).
- El **cubo 7** existe, pero no cuenta en ninguno de los dos lados.

### Métricas derivadas

```text
growth        = (reciente − anterior) / max(anterior, 1)
baselineRate  = items en (30 min, 6 h] / 165 cubos
recentRate    = reciente / 7
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

Escenario: un tema sobre OpenAI con 40 minutos de vida, movimiento reciente y una
línea base tranquila. Los valores están calculados con el código real
(`computeTrend` con las opciones por defecto).

**Entrada**

- `now = T`, `cluster.firstSeen = T − 40 min`, `lastSeen = T`.
- 20 items dentro de la ventana de 30 minutos: 2 por cubo en los cubos 8–14
  (14 items, de 0,5 a 13,5 minutos atrás) y 1 por cubo en los cubos 0–5
  (6 items, de 20 a 30 minutos atrás). Cubos 6 y 7, vacíos.
- 66 items entre 31 y 356 minutos atrás: la línea base.
- 3 redes: `bluesky`, `hackernews`, `reddit` (7, 7 y 6 items).
- Cada item con `likes: 600`.

**Paso 1 — serie:** `bucketize` da
`[1,1,1,1,1,1,0,0,2,2,2,2,2,2,2]` (suma 20).

**Paso 2 — mitades:** `reciente = 14` (cubos 8–14), `anterior = 6` (cubos 0–6).

**Paso 3 — crecimiento:** `growth = (14 − 6) / 6 = 1,3333…` → `1.333` (o sea,
+133 %).

**Paso 4 — línea base y aceleración:**

- `baselineRate = 66 / 165 = 0,4` items por cubo.
- `recentRate = 14 / 7 = 2` items por cubo.
- `velocity = 2 / 0,4 = 5`.

**Paso 5 — resto de señales:**

- `volume = 20`, `coverage = 3`.
- `engagement = 20 · 600 = 12000`.
- `novelty = clamp01(1 − 40/360) = 0,8889`.
- `cohesion`: 86 items en un lapso de 355,5 minutos → densidad 0,242 →
  `1 − 0,242/12 = 0,98`.

**Paso 6 — score:** con `norm(20, 300) = ln(21)/ln(301) = 0,5335`,
`norm(5, 12) = ln(6)/ln(13) = 0,6986`, `(3 − 1)/4 = 0,5` y
`norm(12000, 50000) = ln(12001)/ln(50001) = 0,8681`:

```text
0,34·0,5335 + 0,30·0,6986 + 0,16·0,5 + 0,12·0,8681 + 0,08·0,8889
= 0,1814 + 0,2096 + 0,0800 + 0,1042 + 0,0711 = 0,6463
score = round(100 · 0,6463) = 65
```

**Paso 7 — estado:** `coverage 3 ≥ 3` y `velocity 5 ≥ 5`, pero `volume 20 < 25`,
así que no es `breaking`; `velocity 5 ≥ 2,5`, `volume 20 ≥ 8` y antigüedad
40 ≤ 90 → **`emerging`**.

**Paso 8 — motivo:** `coverage ≥ 3` y `velocity ≥ 2,5` → **`multi_source`** con
`{ velocity: 5, growth: 133, sources: 3, volume: 20, windowMin: 30 }`.

**Resultado** (`computeTrend` devuelve además `sparkline`, `sources`, `sampleIds`
y `acknowledged`):

```json
{
  "title": "OpenAI",
  "score": 65,
  "state": "emerging",
  "velocity": 5,
  "growth": 1.333,
  "volume": 20,
  "coverage": 3,
  "engagement": 12000,
  "novelty": 0.89,
  "cohesion": 0.98,
  "sources": [
    { "source": "bluesky", "count": 7, "share": 0.35 },
    { "source": "hackernews", "count": 7, "share": 0.35 },
    { "source": "reddit", "count": 6, "share": 0.3 }
  ],
  "reason": {
    "code": "multi_source",
    "params": { "velocity": 5, "growth": 133, "sources": 3, "volume": 20, "windowMin": 30 }
  }
}
```

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
