# Historial de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado [semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido
- Flujo en directo de Bluesky (**Jetstream**) con reconexión exponencial y
  filtrado por términos e idioma. Los items entran por tandas: la interfaz nunca
  se bloquea por un pico de actividad.
- `scripts/install-desktop.sh`: instala binario, iconos y lanzador en el perfil
  del usuario (sin root) y deja un acceso directo en el escritorio.
- `scripts/verify.sh`: verificación completa (tipos, tests, compilación,
  determinismo de los tokens y `cargo check`).

### Cambiado
- **La aplicación ya no arranca con datos de ejemplo.** Sondea las fuentes reales
  y, si no hay nada, lo dice. El generador de ejemplos queda para los tests.
- Rendimiento: tarjetas memorizadas, lista por páginas de 60 y
  `content-visibility` en las filas largas.
- La cabecera indica el estado real de la conexión (en directo, sondeo o error)
  en lugar de un testigo decorativo.

### Corregido
- El clusterizador volvía a agrupar publicaciones ya archivadas y creaba temas
  duplicados en cada sondeo (llegó a haber más temas que publicaciones). Ahora un
  item conserva su tema mientras siga vivo.
- El centroide del tema no se movía nunca (media ponderada sobre el hash previo);
  ahora es votación por mayoría de los 64 bits.
- `bucketize` descartaba el item publicado en el instante actual y dejaba un cubo
  sin contar entre las dos mitades de la ventana.
- Los temas gemelos no se fusionaban: la consolidación no se ejecutaba en cada
  ciclo.
- La consulta por entidades comparaba el filtro consigo mismo.
- El flujo se quedaba en blanco por un bucle de actualización (selector de Zustand
  devolviendo una referencia nueva en cada render).
- `Bluesky` marcaba que no necesitaba proxy cuando su API de búsqueda **sí** lo
  necesita: el navegador la bloquea por CORS. El flujo en directo sí va en ambos.
- El escritorio no compilaba: la API de respaldo de `rusqlite` cambió. La copia de
  seguridad usa ahora `VACUUM INTO`.

### Notas
- La búsqueda de Bluesky, Reddit, Mastodon y RSS requieren la aplicación de
  escritorio: sus servidores no envían cabeceras CORS. Hacker News y GitHub
  funcionan también en el navegador.

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
