# @latido/tokens

Fuente única de verdad del sistema de diseño de Latido. **Ningún componente escribe
un color, tamaño o duración literal**: todo sale de aquí.

```text
src/tokens.mjs      → datos (paleta, tema semántico, tipografía, espacio, movimiento, layout)
scripts/build.mjs   → genera dist/tokens.css y dist/tokens.json
dist/tokens.css     → :root + [data-theme="dark"|"light"] + prefers-color-scheme
```

## Uso

```ts
import '@latido/tokens/tokens.css'

// en CSS
.anything {
  color: var(--color-text);
  background: var(--color-surface);
  border: var(--border-hairline) solid var(--color-border);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  transition: opacity var(--duration-fast) var(--ease-standard);
}
```

```ts
// en TS (colores de series para gráficas)
import tokens from '@latido/tokens'
const [first] = tokens.data.series
```

## Reglas

1. **Semántico antes que crudo.** Usa `--color-surface`, nunca `--graphite-850`.
2. **Un solo acento** (`--color-accent`, ascua `#E4572E`). El resto es neutro cálido.
3. **Prohibido**: morado/índigo genérico, cian neón, degradados de "cristal", emojis decorativos.
4. Los temas se cambian con `data-theme` en `<html>`; sin atributo manda el sistema.

## Build

```bash
pnpm --filter @latido/tokens build
```

Los scripts `predev`/`prebuild` de `@latido/app` lo ejecutan solos. `dist/` no se
versiona; el CI comprueba que el resultado es determinista.
