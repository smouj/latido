# Privacidad

Latido es local-first: no hay cuenta, no hay servidor del proyecto y no hay
telemetría. Esta página dice exactamente qué se guarda, dónde, qué sale a la red
y cómo borrarlo todo.

## Qué se guarda

Todo lo que Latido sabe viene de las fuentes que tú activas:

- **Publicaciones** (`posts`): título, cuerpo, URL, autor (handle y nombre tal
  como los publica la red), métricas (me gusta, respuestas, reposts, comentarios,
  estrellas, puntuación), etiquetas, entidades detectadas, huella `simhash`,
  fecha de publicación y de lectura, idioma detectado y el `origin` que pidió el
  conector.
- **Temas y tendencias**: agrupaciones, palabras clave, entidades, centroide,
  puntuación, estado, motivo, serie temporal y si ya los has visto.
- **Tu configuración**: fuentes activas y sus opciones (subreddits, feeds,
  instancias, búsquedas), reglas de aviso y su estado de enfriamiento, listas,
  entidades vigiladas, marcadores.
- **Tu sesión**: tema claro/oscuro, idioma, filtros activos, identificadores de
  lo leído, lo descartado, fecha de instalación y de última apertura.
- **Diagnóstico de fuentes**: `lastOkAt` y el texto del último error de cada
  fuente.

Lo que Latido **no** guarda: ni tu identidad, ni tu dirección, ni tu ubicación,
ni un identificador de dispositivo, ni nada que sirva para reconocerte entre
instalaciones.

## Dónde se guarda

Nada sale del dispositivo.

| Dónde | Qué | Cómo |
| --- | --- | --- |
| Escritorio (Tauri) | Archivo SQLite con publicaciones, temas, tendencias y series | Esquema `docs/DATA-MODEL.md`, aplicado por el shell |
| Escritorio | Estado de la aplicación (sesión, reglas, instantánea del motor) | Fichero de estado propio (`state_save`) |
| Escritorio | Token de una fuente, si decides ponerlo | Llavero del sistema operativo (`secret_set`); nunca en el archivo ni en la instantánea |
| Escritorio | Sesión del navegador, si la importas | Llavero del sistema (`session.cookie.<fuente>`): **solo** la cabecera `Cookie` montada, los dominios, los nombres incluidos y la procedencia. La cabecera vive en memoria mientras la app está abierta |
| Navegador | Instantánea del motor y sesión | IndexedDB (`latido` / `state` / `snapshot`) |
| Navegador | Reserva si IndexedDB no está disponible | `localStorage`, clave `latido:snapshot` |

Consecuencias honestas de guardar así:

- **No hay cifrado en reposo** para publicaciones y temas: quien pueda leer tus
  archivos de usuario (o el perfil del navegador) puede leer la base. Los
  secretos sí van al llavero del sistema.
- **Exportar una copia** (Ajustes → Exportar) genera un JSON con lo mismo: si lo
  guardas en un sitio compartido, estás compartiendo tu histórico.
- El borrado real de SQLite puede dejar restos en el sistema de archivos hasta
  que el sistema reutilice esos bloques; Latido no hace sobrescritura segura.

## Sesión del navegador

Opcional y apagada por defecto. Si una fuente responde 403 sin sesión (hoy,
Reddit), puedes reutilizar la que ya tienes abierta en tu navegador. Qué implica,
con todas las letras:

- Se lee la base de cookies de **un perfil** de Chrome, Edge, Brave, Chromium o
  Vivaldi, **en solo lectura**. No se copia, no se modifica y no se toca nada
  más: ni historial, ni contraseñas, ni marcadores.
- La clave de cifrado está protegida con DPAPI: solo el usuario de Windows que
  abrió el navegador puede descifrarla. Si falla, la app lo dice y no sigue.
- Lo único que se guarda es la cabecera `Cookie` ya montada, en el llavero del
  sistema. **No** se guarda en el archivo de estado, ni en el archivo SQLite, ni
  en una copia exportada.
- La cabecera sale **solo** hacia los dominios declarados por esa fuente, y solo
  si tú enciendes la opción. La comprobación se hace en cada petición.
- «Olvidar la sesión» borra la entrada del llavero y apaga la opción.
- No se sube a ningún sitio: no hay servidor del proyecto con el que hablar.

El detalle técnico (esquema `v10`, DPAPI, qué no se puede leer y por qué) está en
[`SESSION.md`](SESSION.md).

## Qué sale a la red

Solo peticiones a las fuentes que has activado, y solo mientras la aplicación
está abierta:

| Fuente | A dónde se conecta |
| --- | --- |
| Hacker News | `hacker-news.firebaseio.com` |
| Bluesky | `public.api.bsky.app` y, si usas el flujo en tiempo real, `jetstream2.us-east.bsky.network` |
| Reddit | `www.reddit.com` (o `oauth.reddit.com` con token) |
| Mastodon | las instancias que hayas escrito |
| RSS / Atom | los feeds que hayas escrito |
| GitHub | `api.github.com` |

Todas las peticiones llevan el User-Agent
`Latido/0.1 (+https://github.com/smouj/latido; local-first reader)`, que dice qué
cliente eres y dónde está el proyecto, no quién eres.

Qué ve la red a la que te conectas, sin adornos: tu dirección IP, tu proveedor
de internet, el momento de la petición y que usas Latido. Es lo mismo que vería
si abrieras su web, sin cookies suyas y sin identificarte. Si pones un token,
ese token viaja solo a la API de su red.

Cuando pulsas un enlace o se carga un avatar remoto, la petición sale del
dispositivo (el navegador del sistema o el WebView) y el destino te ve como
cualquier otra visita. Latido abre los enlaces externos con el navegador del
sistema y no incrusta rastreadores, píxeles ni iframes.

## Qué nunca se envía

- Tu histórico: qué has leído, guardado, buscado o descartado.
- Tus listas, entidades vigiladas, reglas de aviso y filtros.
- Tus preferencias (tema, idioma, retención).
- Analíticas de uso, informes de error automáticos o "mejoras de producto".
- Las búsquedas que escribes en el buscador: se resuelven contra el índice local
  del almacén, sin tocar la red.

No hay servidor de Latido al que enviar nada. Si en el futuro se añade algo
opcional que salga del dispositivo, tendrá que ser explícito, desactivado por
defecto y documentado aquí.

## Cómo borrarlo todo

1. **Desde la aplicación.** Ajustes → "Borrar todo lo guardado" pide confirmación
   y llama a `clearState()`: borra el fichero de estado (escritorio) o la entrada
   de IndexedDB y la de `localStorage` (navegador). Las publicaciones, temas,
   avisos y preferencias se van con él.
2. **El archivo SQLite.** El archivo de la base de datos vive en el directorio de
   datos de la aplicación. Borra el directorio entero para no dejar rastro
   (equivale a desinstalar y perder la configuración).
3. **Los tokens.** Se borran desde el llavero del sistema (`secret_delete`) o
   desde la propia utilidad de llavero del sistema operativo.
4. **Las copias exportadas.** Si has usado Exportar, esos JSON son tuyos y están
   donde los pusieras: Latido no los gestiona.

Y para reducir lo que se acumula sin borrarlo todo: Ajustes → "Conservar
publicaciones" (30 días por defecto, o "Siempre"). La poda no toca las
tendencias que aún no has visto.

## Menores y datos de terceros

Latido muestra lo que otras personas publican en redes públicas. Esos textos,
nombres y avatares son de quien los escribió, y su tratamiento por tu parte
depende de ti: Latido no los envía a ningún sitio, pero tú sí puedes exportarlos
o publicarlos. Si vas a hacerlo, mira las condiciones de la red de origen.

## Cambios

Si esta política cambia, el cambio va en el historial del repositorio, con el
resto del código. Ahí se puede ver qué decía antes y quién lo cambió.
