# Historial de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado [semántico](https://semver.org/lang/es/).

## [0.2.0] — 2026-09-17

### Añadido
- **Tres temas oficiales, uno por sistema** (`windows`, `macos`, `linux`). Cada uno
  cambia lo que debe cambiar —radios, densidad de fila, familia tipográfica,
  elevación y temperatura del neutro— y deja intactas la marca y la escala
  tipográfica. Se eligen en Ajustes, con vista previa, y la app detecta el sistema
  la primera vez. Ver `docs/screenshots/tema-windows.png`, `tema-macos.png`,
  `tema-linux.png`.
- **Traducción automática del contenido al idioma que lees**, con proveedores
  LibreTranslate, DeepL y OpenAI (además de «sin traductor»), detección de idioma
  sin modelos, caché para no pagar dos veces por el mismo texto, cola con
  concurrencia y espaciado, y **botón para ver el original** en cada publicación.
  La clave del proveedor se guarda en el llavero del sistema, nunca en el archivo
  de estado.
- **Marca definitiva**: superelipse de esquina continua y latido con pico y valle,
  generados por `scripts/make-icons.mjs` junto con el vector y el logo de la
  interfaz (una sola fuente de verdad). Ver `docs/brand/`.
- `scripts/install-desktop.sh`: instala binario, iconos, lanzador y acceso directo
  en Linux sin `root`.
- `scripts/verify.sh`: verificación completa (tipos, tests, compilación,
  determinismo de tokens y `cargo check`).

### Cambiado
- **La aplicación ya no arranca con datos de ejemplo.** Sondea las fuentes reales
  y, si no hay nada, lo dice. El generador de ejemplos queda para los tests.
- **Escalado y adaptación**: columnas fluidas (`clamp`) en vez de anchos fijos, la
  ventana no hace scroll —lo hacen las columnas—, `scrollbar-gutter` para que no
  salte el contenido al aparecer la barra, y el contexto lateral se retira antes
  de apretujar el contenido.
- **Rendimiento**: tarjetas memorizadas, lista por páginas de 60 y
  `content-visibility` en las filas largas.
- La cabecera indica el estado real de la conexión (en directo, sondeo o error)
  en lugar de un testigo decorativo.

### Corregido
- El clusterizador volvía a agrupar publicaciones ya archivadas y creaba temas
  duplicados en cada sondeo (llegó a haber más temas que publicaciones).
- El centroide del tema no se movía nunca (media ponderada sobre el hash previo).
- `bucketize` descartaba el item publicado en el instante actual.
- Los temas gemelos no se fusionaban: la consolidación no se ejecutaba por ciclo.
- La consulta por entidades comparaba el filtro consigo mismo.
- El flujo se quedaba en blanco por un bucle de actualización (selector de Zustand
  devolviendo una referencia nueva en cada render).
- Bluesky marcaba que no necesitaba proxy cuando su API de búsqueda **sí** lo
  necesita: el navegador la bloquea por CORS. El flujo en directo va en ambos.
- El escritorio no compilaba: la API de respaldo de `rusqlite` cambió.

### Notas
- La búsqueda de Bluesky, Reddit, Mastodon y RSS requieren la aplicación de
  escritorio: sus servidores no envían cabeceras CORS. Hacker News y GitHub
  funcionan también en el navegador, y el flujo de Bluesky en ambos.

## [0.1.0] — 2026-09-17

Primera versión con motor, interfaz y escritorio.

### Añadido
- Motor en TypeScript: conectores (Hacker News, Bluesky, GitHub, Reddit,
  Mastodon, RSS/Atom), normalización canónica, agrupación incremental y **Trend
  Engine** con velocidad, cobertura, novedad y motivo explicable.
- Reglas de aviso con enfriamiento persistente y avisos del sistema.
- Interfaz completa: Inicio, Ahora mismo, Radar, Siguiendo, Explorar, Buscar,
  Guardados, Avisos, Listas, Fuentes y Ajustes; tema oscuro y claro; español e
  inglés; paleta de comandos.
- Sistema de diseño tokenizado con generación determinista de CSS y JSON.
- Aplicación de escritorio Tauri 2: ventana, instancia única, avisos, apertura de
  enlaces, llavero del sistema y archivo SQLite con FTS5.
- CI, CodeQL, Dependabot, plantillas de incidencia y de PR, y licencia AGPL-3.0.
