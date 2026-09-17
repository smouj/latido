# Seguridad

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Un issue público avisa a cualquiera antes de que
haya arreglo.

1. Usa el canal privado de GitHub: pestaña **Security** → **Report a
   vulnerability** (avisos de seguridad privados del repositorio). Es el canal
   preferido porque permite adjuntar pruebas y coordinar la publicación.
2. Si no puedes usarlo, abre un issue **sin detalles** pidiendo un canal
   privado; se te dirá por dónde seguir.
3. Contacto alternativo: `smouj@users.noreply.github.com`.

Qué incluir: versión (Ajustes → Acerca de), sistema y forma de uso (escritorio o
navegador), pasos para reproducirlo, impacto que le ves y, si tienes, una prueba
mínima. Nada de datos personales ni tokens ajenos.

Qué esperar: acuse de recibo y una primera valoración en unos días, y aviso
antes de publicar nada. Al no haber servidor ni servicio alojado, no hay "ventana
de mantenimiento": el arreglo llega en la siguiente versión.

## Modelo de amenaza

Latido es una aplicación de escritorio/navegador que **no tiene servidor propio**,
**no tiene cuentas** y **no recibe conexiones entrantes**. Eso deja cuatro
superficies reales:

### 1. Datos locales

- Publicaciones, temas, series temporales, reglas y preferencias viven en el
  dispositivo: SQLite y un fichero de estado en el escritorio; IndexedDB en el
  navegador (ver `docs/PRIVACY.md`).
- **No hay cifrado en reposo.** El adversario aquí es quien ya tiene acceso a tu
  sesión de usuario en el equipo. Lo que protege Latido no es la criptografía,
  sino el aislamiento normal del sistema operativo.
- Los **secretos** (token opcional de Reddit o GitHub) van al llavero del sistema
  operativo (`secret_set`), no al archivo de datos ni a la instantánea.
- El botón de borrado (Ajustes → "Borrar todo lo guardado") elimina el estado,
  pero no sobrescribe bloques de disco: no es un borrado forense.

### 2. Enlaces externos

- `open_external` **solo acepta `http://` y `https://`** y rechaza cualquier otro
  esquema: nada de `file://`, `javascript:` ni esquemas que lancen aplicaciones
  arbitrarias.
- En el navegador, los enlaces se abren con `noopener,noreferrer`.
- El resto de enlaces que abre Latido son los que aparecen en los items: van al
  navegador del sistema, con las protecciones de ese navegador.

### 3. Contenido de terceros tratado como datos

Lo que llega de las redes es **contenido no confiable** y se trata como tal:

- Se pinta como **texto**. La interfaz no usa `dangerouslySetInnerHTML` ni
  `innerHTML` en ningún sitio: React escapa el texto por defecto, así que un
  titular con etiquetas o scripts no se ejecuta.
- El HTML que sí llega (comentarios de Hacker News, contenido de Mastodon) se
  limpia en el conector y se recorta a texto plano.
- El WebView de Tauri usa una **CSP** restrictiva (`tauri.conf.json`):
  `default-src 'self'`; `img-src 'self' data: https:`; `style-src 'self'
  'unsafe-inline'`; `font-src 'self' data:`; `connect-src 'self' ipc:
  http://ipc.localhost`. No hay `script-src` remoto ni `eval` en el código.
- Los permisos del shell son mínimos (`capabilities/default.json`):
  `core:default`, `opener:allow-open-url` y `notification:default`. Lo que no sea
  imprescindible para leer fuentes y avisar, no está.
- El parseo de XML (RSS) y de JSON se hace con librerías mantenidas
  (`fast-xml-parser`, `JSON.parse`), sin `eval` ni construcción dinámica de
  código.

### 4. Red saliente

- Solo hay conexiones a las fuentes activadas, desde tu equipo, con tu IP.
- Los conectores no aceptan destinos arbitrarios: los hosts están fijados en el
  código, salvo RSS/Mastodon/GitHub/Bluesky, donde la URL la escribes tú.
- Consecuencia conocida y aceptada: si añades un feed que apunta a una dirección
  interna (por ejemplo `http://127.0.0.1:8080/feed`), Latido intentará leerla.
  Está en tus manos; no hay nada del otro lado que se pueda atacar desde fuera.
- No hay servidor que pueda ser escaneado, ni puerto a la escucha, ni webhooks.

## Qué NO es un fallo

- **Que un titular sea falso.** Latido no verifica la verdad de nada: muestra lo
  que dicen las fuentes y de quién lo dicen. Una noticia falsa publicada en una
  red abierta es un contenido, no una vulnerabilidad nuestra.
- **Que un tema mezcle dos historias.** El agrupador pondera 0,40 palabras +
  0,25 simhash + 0,35 entidades y es un compromiso deliberado
  (`docs/TREND-ENGINE.md`): dos noticias distintas de la misma empresa pueden
  caer juntas. Se ve en las palabras clave del tema.
- **Que una fuente falle, limite el ritmo o cambie su API.** Se documenta como
  error de fuente (`lastError`) y el resto de fuentes siguen.
- **Que la base de datos local sea legible por tu propio usuario.** Es un lector
  local-first: si alguien tiene tu sesión abierta, tiene tus datos.
- **Que un autor mienta sobre quién es.** El handle y el nombre son los que
  publica la red de origen; Latido no los verifica.
- **Que el contenido te parezca ofensivo.** Latido no modera: filtra `over_18`
  de Reddit y nada más.
- **Ejecutar una versión antigua.** Si has ignorado el aviso de versión y el
  fallo ya está arreglado aguas arriba, actualiza antes de reportar.

## Dependencias y cadena de suministro

- El monorepo usa pnpm con `pnpm-lock.yaml` versionado: las instalaciones de CI y
  de release son `--frozen-lockfile`.
- Dependabot revisa semanalmente npm y las GitHub Actions, agrupado, en
  `.github/dependabot.yml`.
- CodeQL analiza JavaScript/TypeScript en cada push, en cada pull request y una
  vez por semana.
- Las dependencias del motor son mínimas por diseño: `fast-xml-parser` y poco
  más; el hashing, el agrupado y las tendencias son código propio.

## Versiones soportadas

Solo la última versión publicada recibe arreglos. Al ser software libre
(AGPL-3.0-or-later) cualquiera puede auditar el código y las versiones anteriores
siguen siendo usables, pero sin soporte.
