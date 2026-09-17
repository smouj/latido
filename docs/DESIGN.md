# Diseño

Este documento es el contrato visual de Latido. Si algo no está aquí, no debería
estar en la interfaz.

- **Tokens:** `packages/tokens/src/tokens.mjs` (fuente única) → `dist/tokens.css`.
- **Regla dura:** ningún componente escribe un color, un tamaño o una duración
  literal. Todo va por `var(--token)`. Si hace falta un valor nuevo, se añade al
  token y se documenta aquí.

---

## 1. Por qué no se parece a lo que hace todo el mundo

La mayoría de las aplicaciones "de datos" se ven igual: fondo azul-morado oscuro,
acento índigo o cian neón, degradados de cristal, tarjetas flotando con sombras
grandes y emojis decorativos. Es el uniforme de la IA, y no comunica nada.

Latido parte de tres decisiones incómodas:

1. **Un solo acento.** El ascua (`#E4572E`) es el único color con carácter.
   Sirve para una cosa: *esto está vivo*. Si todo brilla, nada brilla.
2. **Neutros cálidos.** El fondo es grafito con temperatura (`#131110`, no
   `#0A0A0F`): cansa menos la vista y no parece una terminal militar.
3. **Jerarquía por espacio y peso, no por cajas.** Se usan líneas de 1 px y aire,
   no sombras y bordes redondeados por todas partes. La app se lee como una
   tabla bien maquetada, no como una pila de tarjetas.

La estructura de tres columnas sí bebe de X —es la que todo el mundo entiende—,
pero la piel es nuestra.

---

## 2. Color

### Paleta cruda

No se usa directamente en componentes. Existe para definir el tema semántico.

| Grupo | Uso | Ejemplo |
| --- | --- | --- |
| `graphite` | superficies del tema oscuro | `#131110`, `#1A1816`, `#2E2A26` |
| `paper` | superficies del tema claro | `#F6F2EA`, `#FFFDF9`, `#DFD7C9` |
| `ember` | acento, en tres intensidades | `#E4572E`, `#C7461D`, `#F0683E` |
| `support` | estados: sage, amber, clay, slate | `#7BA96B`, `#D9A343`, `#C4453C`, `#6E93A8` |
| `source` | identidad de cada red, solo como punto de 8 px | `#4A9BE0` Bluesky, `#E86A3C` Reddit… |

### Tokens semánticos

Existen dos juegos completos, `dark` (por defecto) y `light`, con los mismos
nombres. Cambiar de tema **nunca** toca un componente.

```text
--color-bg            fondo de la aplicación
--color-surface       superficie elevada un paso (paneles, filas al pasar)
--color-surface-raised superficie elevada dos pasos (barras, pastillas)
--color-surface-inset  hueco (campos de formulario, bloques de motivo)
--color-border / --color-border-strong
--color-text / --color-text-muted / --color-text-faint
--color-accent / --color-accent-hover / --color-accent-fg / --color-accent-soft / --color-accent-line
--color-positive / --color-warning / --color-danger / --color-info
--color-selection / --color-focus / --color-skeleton
--color-overlay
--shadow1 / --shadow2
```

El tema se elige con `data-theme` en `<html>`. Sin atributo, manda el sistema
operativo (`prefers-color-scheme`).

### Reglas de uso

- El acento marca **una** cosa por pantalla: el estado vivo, el tema que crece,
  la acción principal. Nunca dos.
- Los colores de fuente (`--source-*`) solo aparecen como puntos de 8 px junto al
  nombre. No se pintan fondos de tarjeta con el color de una red.
- Verde = sube, arcilla = falla o peligro, ámbar = atención. Nada más.
- Contrastes objetivo: texto normal ≥ 4,5:1; texto grande y adornos ≥ 3:1.

---

## 3. Tipografía

| Rol | Familia | Por qué |
| --- | --- | --- |
| Interfaz | **Manrope Variable** | Geométrica y humanista; no es Inter (el uniforme de IA), y tiene excelente comportamiento en tamaños pequeños |
| Datos | **IBM Plex Mono** | Cifras tabulares para que los números no bailen al actualizarse |

Ambas se empaquetan (`@fontsource`), así que la app no pide fuentes a nadie y
funciona sin conexión.

```text
--text-2xs  11px   etiquetas en mayúsculas, espaciadas
--text-xs   12px   metadatos, horas, cuentas
--text-sm   13px   acciones, notas al pie
--text-base 14px   texto corrido de una publicación
--text-md   15px   titulares de publicación, elementos de navegación
--text-lg   17px   subtítulos
--text-xl   20px   títulos de pantalla
--text-2xl  24px   titulares de sección
--text-display     fluido, solo en la bienvenida
```

Reglas: los titulares llevan `--tracking-tight` (−0,02 em); las etiquetas en
mayúsculas, `--tracking-caps` (+0,08 em) y color `--color-text-faint`. Los
números siempre en `--font-mono` con `font-variant-numeric: tabular-nums`.

---

## 4. Espacio, forma y movimiento

- **Espaciado:** base 4 px, escala `--space-1` (4) … `--space-20` (80). No hay
  valores intermedios.
- **Radios:** `xs 4`, `sm 6`, `md 10`, `lg 14`, `xl 18`, `pill 999`. Las
  pastillas son para acciones y filtros; las tarjetas usan `lg`.
- **Bordes:** 1 px (`--border-hairline`) casi siempre; 2 px solo para el filo de
  acento del bloque de motivo.
- **Elevación:** casi inexistente. `--shadow1` para la marca, `--shadow2` solo en
  superposiciones (paleta de comandos, avisos flotantes).
- **Movimiento:** `instant 90ms`, `fast 140ms`, `base 200ms`, `slow 320ms`.
  Curva estándar `cubic-bezier(0.2, 0.8, 0.2, 1)`. Solo se anima lo que cambia
  de estado: nada de animaciones de entrada por decorar.
- `prefers-reduced-motion` deja todas las duraciones a cero: la app sigue siendo
  completamente usable.

---

## 5. Estructura

```text
┌───────────┬──────────────────────────────┬──────────────┐
│  lateral  │  cabecera pegada             │  columna     │
│  15.5rem  │  título · buscar · vivo      │  derecha     │
│           ├──────────────────────────────┤  20rem       │
│  navegación│  filtros (chips)            │              │
│  + estado  │  ─────────────────────────   │  Radar       │
│           │  publicaciones / temas       │  Emergiendo  │
│           │  ancho máx. 40rem            │  Reparto     │
└───────────┴──────────────────────────────┴──────────────┘
```

- **≤ 72 rem:** desaparece la columna derecha (el contenido manda).
- **≤ 56 rem:** desaparece la lateral y entra una barra inferior de 5 pestañas,
  con `env(safe-area-inset-bottom)` para móviles con gesto inferior.
- La cabecera es pegajosa con desenfoque y borde inferior de 1 px, nunca con
  sombra dura.

---

## 6. Componentes y su gramática

**Publicación (`PostCard`).** Avatar · red · autor · hora · tiempo relativo
arriba (contexto); titular y texto en medio (lo que se lee); métricas y acciones
abajo (lo que se compara). Si pertenece a un tema agrupado, aparece cuántas
publicaciones hablan de lo mismo.

**Tema (`TrendCard`).** Fila de cabecera con puesto, título, estado y pulso.
Segunda fila con los datos duros. Sparkline. Al abrir: rejilla de seis métricas,
reparto por red en barras y un **bloque de motivo** con filo de acento que
responde a "¿por qué aparece aquí?".

**Estado (`StateBadge`).** `breaking` se rellena con acento (lo único que se
rellena); `emerging` lleva acento suave; `rising`, verde apagado; `fading` y
`quiet`, gris. Nunca dos insignias de color en la misma fila.

**Sparkline.** Barras de 2 px de separación; por encima de 1,6 × la media se
pintan con acento. Se entiende sin leer un solo número.

**Vacíos.** Icono en un cuadrado con borde, una frase y —si hay algo que hacer—
una sola acción. Nunca un vacío que no diga qué hacer.

**Paleta de comandos (⌘K / Ctrl+K).** Busca a la vez en comandos y en el archivo
local. Es el atajo que separa una app de escritorio de una página web.

---

## 7. Accesibilidad

- Foco visible siempre (`--focus-ring`, 2 px, con desplazamiento).
- Todo control es un `button`, un `input` o un `a` real; nada de `div` con
  `onClick`.
- Los conmutadores usan `role="switch"` y `aria-checked`; los filtros,
  `aria-pressed`; la vista actual, `aria-current="page"`.
- Los avisos flotantes viven en una región `aria-live="polite"`.
- El color no es la única señal: cada estado tiene además texto y forma.

---

## 8. Añadir algo nuevo

1. ¿Hace falta un valor nuevo? Va a `tokens.mjs`, no al componente.
2. ¿Es un color de dato? Usa `tokens.data.series`.
3. ¿Es texto? Va a `apps/app/src/i18n/index.ts` en **español e inglés**. La
   interfaz no lleva cadenas sueltas.
4. ¿Es un estado? Reutiliza `StateBadge` antes de inventar otro.
5. Comprueba el resultado en tema claro **y** oscuro, a 360 px y a 1440 px.
