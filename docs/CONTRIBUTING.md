# Cómo contribuir

Gracias por el interés. Este documento dice qué hace falta para trabajar en
Latido y qué se espera de un cambio.

Antes de escribir código, lee `docs/ARCHITECTURE.md` (capas y por qué están así)
y `docs/CONNECTORS.md` si vas a tocar una fuente. Los números del agrupado y de
las tendencias están en `docs/TREND-ENGINE.md` y el esquema en
`docs/DATA-MODEL.md`.

## Entorno

| Herramienta | Versión | De dónde sale |
| --- | --- | --- |
| Node | ≥ 20.19 (el `.nvmrc` fija 20.19.0) | `engines.node` en `package.json` |
| pnpm | 10.32.1 | `packageManager` en `package.json` |
| Rust | estable (el `Cargo.toml` pide ≥ 1.77.2) | solo para el escritorio |

```bash
git clone https://github.com/smouj/latido.git
cd latido
pnpm install --frozen-lockfile
```

Para el escritorio hacen falta además las dependencias del sistema de Tauri 2
(WebKitGTK 4.1, `libappindicator3`, `librsvg2`, `patchelf` en Linux). Están en
`.github/workflows/release.yml`, en el paso de dependencias del sistema.

## Comandos reales del repositorio

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Interfaz en el navegador (Vite, `127.0.0.1:5173`); compila los tokens antes |
| `pnpm dev:desktop` | `tauri dev`: la misma interfaz dentro de la ventana de escritorio |
| `pnpm build` | Tokens → motor → aplicación |
| `pnpm build:desktop` | `pnpm build` y después `tauri build` |
| `pnpm preview` | Sirve la compilación web (`4173`) |
| `pnpm typecheck` | `pnpm -r typecheck`: tipos en todos los paquetes |
| `pnpm test` | Tests del motor (`vitest run` en `packages/engine`) |
| `pnpm test:watch` | Los mismos tests en modo vigilancia |
| `pnpm lint` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier escribe / comprueba |
| `pnpm verify` | `bash scripts/verify.sh`: la comprobación completa del repositorio |
| `pnpm clean` | Borra `dist`, el `target` de Tauri y lo compilado |

Por paquete, con filtro:

```bash
pnpm --filter @latido/tokens build
pnpm --filter @latido/engine test
pnpm --filter @latido/app build
pnpm --filter @latido/desktop exec tauri build
```

Antes de abrir un pull request: `pnpm test`, `pnpm typecheck` y `pnpm verify` en
verde. Si tocas el agrupado o las tendencias, añade o ajusta el test
correspondiente en `packages/engine/tests/`; los números documentados tienen que
seguir cuadrando.

## Estructura

```text
packages/engine/   motor: conectores, normalización, agrupado, tendencias, avisos, almacén
  src/index.ts     única superficie pública: lo que no se exporta aquí, no es API
  src/sources/     un archivo por red
  tests/           tests del motor (vitest, entorno node)
packages/tokens/   sistema de diseño: src/tokens.mjs → dist/tokens.css y dist/tokens.json
apps/app/          interfaz React (la misma para navegador y escritorio)
  src/i18n/        todos los textos, en español e inglés
  src/platform/    bridge.ts: lo único que depende del entorno
  src/state/       estado de la aplicación (Zustand)
apps/desktop/      shell Tauri: ventana, llavero, notificaciones, archivo SQLite
```

## Convenciones de estilo

- **Ningún valor literal en CSS.** Colores, tamaños, espaciados, radios,
  duraciones y curvas salen de los tokens: `var(--color-surface)`,
  `var(--space-4)`, `var(--duration-fast)`… Si falta un token, se añade en
  `packages/tokens/src/tokens.mjs` (y se regenera `dist` con
  `pnpm --filter @latido/tokens build`). `packages/tokens/README.md` recoge las
  reglas del sistema.
- **Todo texto de interfaz va en `apps/app/src/i18n/index.ts`**, en los dos
  idiomas. `es` es la tabla de referencia (`MessageKey` sale de ella) y `en` está
  tipada contra ella: si falta una clave o sobra, TypeScript lo dice al compilar.
  En los componentes se usa `t('clave')`, nunca una cadena suelta.
- **Formato:** `.editorconfig` (UTF-8, LF, 2 espacios, 100 columnas; 4 espacios
  en `.rs`), Prettier y ESLint. `pnpm format:check` es lo que pasa en revisión.
- **TypeScript estricto:** `strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`. Nada de `any` suelto para salir del paso.
- **El motor no tiene I/O implícito.** Dentro de `packages/engine` no se llama a
  `fetch` ni a `Date.now()` directamente: se usa lo que llega por parámetro
  (`ctx.fetch`, `ctx.now`, `clock`). Es lo que permite probarlo sin red y con
  resultados reproducibles.
- **Comentarios en español, decisiones explicadas.** Un comentario dice *por qué*,
  no *qué*. Si descartas una alternativa interesante, deja escrito el motivo.
- **Nada de secretos** en el repositorio: ni tokens, ni bases de datos
  (`*.sqlite` están en `.gitignore`), ni capturas con datos de terceros.
- **Sin emojis decorativos** ni frases de marketing, ni en el código ni en la
  documentación.

## Añadir un conector

El procedimiento completo, con un ejemplo de código, está en
`docs/CONNECTORS.md`. En resumen: archivo nuevo en
`packages/engine/src/sources/`, registrar en `CONNECTORS` y en
`defaultSourceConfigs()`, añadir el `kind` a `SourceKind`, prueba con `fetch`
falso y la fila en la tabla de fuentes del documento.

Reglas que no se negocian en un conector: identificar la aplicación
(User-Agent), respetar los límites de la red, no lanzar por un fallo puntual
(registrarlo con `ctx.log`), rellenar `origin` y no pedir credenciales si la red
funciona sin ellas.

## Cómo se revisa un pull request

1. **CI primero.** Matriz de Node 20 y 22 (instalar, tokens, tipos, tests del
   motor, compilar la aplicación) y el job de determinismo de `tokens/dist`.
   CodeQL corre además en cada pull request.
2. **Plantilla.** Rellena `.github/PULL_REQUEST_TEMPLATE.md`: qué cambia, cómo lo
   has comprobado y la lista de comprobación.
3. **Revisión de contenido:** un cambio, un motivo; sin refactorizaciones
   mezcladas con arreglos; sin dependencias nuevas si el repositorio ya resuelve
   el problema (y si se añade una, con motivo escrito).
4. **Revisión de datos:** si tocas el esquema, `SCHEMA_VERSION` sube y hay
   migración; si tocas el agrupado o las tendencias, la documentación numérica se
   actualiza; si tocas los textos, los dos idiomas.
5. **Aprobación.** `@smouj` es el propietario del repositorio
   (`.github/CODEOWNERS`) y quien aprueba y fusiona.

Los cambios que añadan cuentas, telemetría, un servidor propio o automatización
de X fuera de su API se cierran sin más discusión: van contra el diseño del
proyecto.

## Errores y propuestas

- **Error:** `.github/ISSUE_TEMPLATE/bug_report.yml` (versión, sistema, fuente
  implicada, pasos, registros).
- **Propuesta:** `.github/ISSUE_TEMPLATE/feature_request.yml`.
- **Seguridad:** por el canal privado, como explica `docs/SECURITY.md`. Nunca en
  un issue público.

## Licencia

Latido es software libre bajo **AGPL-3.0-or-later** (`LICENSE`). Al contribuir,
aceptas que tu aportación se distribuye con esa misma licencia. Ten en cuenta qué
implica la AGPL: quien ofrezca Latido como servicio en red tiene que ofrecer
también el código fuente.
