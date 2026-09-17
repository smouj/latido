# Sesión del navegador

Reddit responde **403** a quien no lleva sesión. La solución no es pedirte una
cuenta nueva ni inventarse datos: es reutilizar la sesión que ya tienes abierta.

Esta página cuenta exactamente cómo se lee esa sesión, qué se guarda y qué no.

## Qué se lee

Navegadores de la familia Chromium en Windows (Chrome, Edge, Brave, Chromium,
Vivaldi). De un perfil concreto:

| Sitio | Qué es |
| --- | --- |
| `…/User Data/<perfil>/Network/Cookies` | Base SQLite con las cookies. Se abre **en solo lectura**. |
| `…/User Data/Local State` | JSON con `os_crypt.encrypted_key`. |

Nada más: ni historial, ni contraseñas, ni marcadores.

## Cómo está cifrado

1. Cada valor de la tabla `cookies` empieza por `v10` y va cifrado con
   **AES-256-GCM**: `v10` + nonce de 12 bytes + texto cifrado + etiqueta.
2. La clave de 32 bytes está en `Local State`, en `os_crypt.encrypted_key`, en
   base64 y precedida de la marca `DPAPI`.
3. Esa clave está protegida con **DPAPI** (`CryptUnprotectData`), es decir, con la
   identidad del usuario de Windows que abrió el navegador. Solo ese usuario puede
   descifrarla; desde otra cuenta o desde otro equipo, no.

Las versiones antiguas de Chrome anteponían al texto un resumen SHA-256 del
dominio: se recorta si está. Las instalaciones muy antiguas guardaban el valor en
claro en la columna `value`: también se acepta.

`v20` (Chrome 127 y posteriores) **no se puede leer** desde fuera de Chrome: exige
la identidad de la propia aplicación ante un servicio elevado de Windows. Cuando
aparece, la aplicación lo dice con esas palabras y no sigue.

## Qué se guarda

En el **llavero del sistema** (Credential Manager en Windows), bajo
`app.latido.desktop` / `session.cookie.<fuente>`, un único JSON con:

- la cabecera `Cookie` ya montada,
- los dominios a los que se puede enviar,
- los nombres de las cookies incluidas,
- el navegador y el perfil de los que salió,
- cuándo se importó.

Es todo. **No** se guarda la base de datos de cookies, ni valores sueltos, ni nada
en el archivo de estado de la aplicación ni en el archivo SQLite. La cabecera vive
en memoria mientras la aplicación está abierta y se suelta al cerrarla.

## Cómo se usa

- Solo se añade a las peticiones cuyo host esté entre los dominios declarados por
  esa fuente. La comprobación se hace en `packages/engine/src/sources/http.ts`, en
  cada petición: la sesión de un sitio no puede acabar en una petición a otro.
- La opción se enciende por fuente, en **Ajustes → Sesión del navegador**, y se
  puede apagar sin borrarla, o borrarla con «Olvidar la sesión».
- No se sube a ningún sitio. No hay servidor del proyecto con el que hablar.

## Lo que esta vía no resuelve

**Bluesky no se autentica con cookies.** Su AppView es AT Protocol: la búsqueda
pública responde 403 a una petición anónima desde según qué redes y espera un
token `Bearer`, no una cookie. Comprobado en esta máquina:

```text
public.api.bsky.app searchPosts  → 403
public.api.bsky.app getProfile   → 200
public.api.bsky.app getTimeline  → 401   (pide autenticación)
misma búsqueda vía otra red      → 200
```

Por eso la interfaz declara la necesidad de sesión de Bluesky pero avisa de que
las cookies no bastan: hace falta un token de sesión, que es trabajo aparte.

## Cómo se prueba

```bash
# Lógica de descifrado, dominios y cabecera (sin sistema operativo de por medio)
cd apps/desktop/src-tauri/crates/latido-chrome-session && cargo test

# Que el camino de Windows (DPAPI) compila
cargo check --target x86_64-pc-windows-msvc

# Que la cabecera solo viaja a donde debe
pnpm --filter @latido/engine test
```

El descifrado con DPAPI de verdad solo se puede ejecutar en Windows: es el único
sitio donde existe `CryptUnprotectData`. Por eso todo el algoritmo está fuera de
esa llamada y cubierto con pruebas que cifran y descifran de ida y vuelta.
