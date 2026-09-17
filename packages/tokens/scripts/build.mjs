#!/usr/bin/env node
/**
 * Emite los tokens de diseño como variables CSS y JSON.
 *   dist/tokens.css   → consumido por apps/app (import '@latido/tokens/tokens.css')
 *   dist/tokens.json  → consumido por herramientas, tests y el tema de Tauri
 *
 * Determinista: mismo input, mismo output byte a byte (el CI lo comprueba).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import tokens from '../src/tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'dist')

const HEADER = `/* GENERADO POR scripts/build.mjs — NO EDITAR A MANO.
   Fuente: packages/tokens/src/tokens.mjs
   Latido · sistema de diseño · Grafito y ascua */\n`

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()

/** Aplana un objeto anidado a pares `prefijo-clave: valor`. */
function flatten(obj, prefix = '') {
  const out = []
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}-${kebab(key)}` : kebab(key)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...flatten(value, name))
    } else {
      out.push([name, String(value)])
    }
  }
  return out
}

const staticGroups = {
  font: tokens.typography.family,
  'text-size': tokens.typography.size,
  'leading': tokens.typography.leading,
  'tracking': tokens.typography.tracking,
  'weight': tokens.typography.weight,
  'space': tokens.space,
  'radius': tokens.radius,
  'border': tokens.border,
  'duration': tokens.motion.duration,
  'ease': tokens.motion.ease,
  'layout': tokens.layout,
  'z': tokens.z,
  'bp': tokens.breakpoint,
  'source': tokens.palette.source,
}

const seriesVars = tokens.data.series.map((value, i) => [`series-${i + 1}`, value])

const staticVars = [
  ...Object.entries(staticGroups).flatMap(([prefix, group]) => flatten(group, prefix)),
  ...seriesVars,
  ['data-grid', tokens.data.grid],
  // Densidad de fila: cada tema de plataforma la ajusta (1 = la de siempre).
  ['density', '1'],
  // Escala de la interfaz: 1 = tamaño de diseño. Se ajusta en Ajustes o sola,
  // según el escalado del sistema (Windows al 125-150 % agranda todo).
  ['ui-scale', '1'],
  ['control-highlight', 'transparent'],
]

const byName = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
const block = (pairs, indent = '  ') =>
  pairs
    .slice()
    .sort(byName)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n')

const colorVars = (name) => flatten(tokens.theme[name], 'color')
const aliasVars = (from, to) => colorVars(from).map(([n, v]) => [n.replace('color-', `${to}-`), v])

let css = `${HEADER}\n:root {\n${block(staticVars)}\n\n  color-scheme: dark;\n}\n`

css += `\n/* Tema oscuro (por defecto) */\n:root,\n[data-theme='dark'] {\n${block(bodyColors('dark'))}\n}\n`

css += `\n/* Tema claro */\n[data-theme='light'] {\n${block(bodyColors('light'))}\n}\n`

css += `\n/* Sin elección explícita: seguimos al sistema operativo. */\n@media (prefers-color-scheme: light) {\n  :root:not([data-theme]) {\n${block(bodyColors('light'), '    ')}\n  }\n}\n`

css += `\n/* Tokens de elevación y foco, resueltos sobre el tema activo. */\n:root {\n${block([
  ['focus-ring', '2px solid var(--color-focus)'],
  ['focus-offset', '2px'],
])}\n}\n`

css += `\n/* Compatibilidad con prefers-reduced-motion: la app sigue siendo usable. */\n@media (prefers-reduced-motion: reduce) {\n  :root {\n    --duration-instant: 0ms;\n    --duration-fast: 0ms;\n    --duration-base: 0ms;\n    --duration-slow: 0ms;\n    --duration-pulse: 0ms;\n  }\n}\n`

// ── temas de plataforma ──────────────────────────────────────────────────────
//
// Tres temas oficiales, uno por sistema. Se aplican **encima** del tema base
// (`data-theme`), así que un componente nunca necesita saber en qué sistema
// corre: sigue leyendo `var(--color-surface)`.

for (const [name, platform] of Object.entries(tokens.platforms)) {
  const structural = [
    ...flatten(platform.family, 'font'),
    ...flatten(platform.radius, 'radius'),
    ['density', platform.density],
  ]

  css += `\n/* Tema ${platform.label}: ${platform.hint} */\n[data-platform='${name}'] {\n${block(structural)}\n}\n`

  for (const appearance of ['dark', 'light']) {
    const overrides = platform[appearance]
    if (!overrides) continue
    const pairs = flatten(overrides, 'color')
    if (pairs.length === 0) continue
    css += `\n[data-platform='${name}'][data-theme='${appearance}'] {\n${block(pairs)}\n}\n`
  }
}

// Sin elección explícita de tema, seguimos al sistema también con plataforma
// fijada: así la primera pintura no destella en blanco.
for (const [name, platform] of Object.entries(tokens.platforms)) {
  const pairs = flatten(platform.light ?? {}, 'color')
  if (pairs.length === 0) continue
  css += `\n@media (prefers-color-scheme: light) {\n  [data-platform='${name}']:not([data-theme]) {\n${block(pairs, '    ')}\n  }\n}\n`
}

function bodyColors(name) {
  return colorVars(name)
}

const json = JSON.stringify(
  {
    generatedBy: 'packages/tokens/scripts/build.mjs',
    static: Object.fromEntries(staticVars),
    themes: { dark: Object.fromEntries(colorVars('dark')), light: Object.fromEntries(colorVars('light')) },
    platforms: Object.fromEntries(
      Object.entries(tokens.platforms).map(([name, platform]) => [
        name,
        {
          label: platform.label,
          density: platform.density,
          radius: platform.radius,
          font: platform.family,
          dark: Object.fromEntries(flatten(platform.dark ?? {}, 'color')),
          light: Object.fromEntries(flatten(platform.light ?? {}, 'color')),
        },
      ]),
    ),
  },
  null,
  2,
)

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'tokens.css'), css, 'utf8')
await writeFile(join(outDir, 'tokens.json'), `${json}\n`, 'utf8')

const count = staticVars.length + colorVars('dark').length * 2
console.log(
  `tokens: ${count} variables base + ${Object.keys(tokens.platforms).length} temas de plataforma → dist/tokens.css, dist/tokens.json`,
)
