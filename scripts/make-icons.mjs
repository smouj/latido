#!/usr/bin/env node
/**
 * Genera la marca de Latido: PNG (16→1024), `icon.ico` e `icon.icns`.
 *
 * Sin dependencias: se dibuja por muestreo de distancias y se codifica a PNG con
 * zlib, que ya trae Node. Determinista —el mismo código produce los mismos
 * bytes—, así que el CI puede comprobarlo.
 *
 * Decisiones de diseño que importan (y por qué):
 *
 * - **Superelipse, no cuadrado redondeado.** `|x|^n + |y|^n = 1` con n≈4.6 da la
 *   esquina continua de los iconos modernos: sin el «codo» que aparece cuando se
 *   redondea un rectángulo.
 * - **Grosor adaptado al tamaño.** A 16 px un trazo proporcional desaparece; por
 *   debajo de 48 px se engrosa un poco para que siga leyéndose. Es lo que hace un
 *   diseñador y lo que no hace un simple reescalado.
 * - **Transparencia de verdad.** Fuera de la superelipse el alfa es 0, así que el
 *   icono se integra en fondos claros y oscuros sin halo blanco.
 * - **Supermuestreo por tamaño.** Cada tamaño se rasteriza por su cuenta, no se
 *   reduce el grande: los bordes quedan limpios en todos.
 *
 *   node scripts/make-icons.mjs            # escribe en apps/desktop/src-tauri/icons
 *   node scripts/make-icons.mjs --out DEST # escribe donde se le diga
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const argOut = process.argv.indexOf('--out')
const outDir = argOut > -1 ? process.argv[argOut + 1] : join(here, '..', 'apps', 'desktop', 'src-tauri', 'icons')

// ── marca ───────────────────────────────────────────────────────────────────

/** Lienzo de referencia: todo se define sobre 1024 y se escala al tamaño final. */
const DESIGN = 1024
/** Exponente de la superelipse (n=2 es círculo, n→∞ cuadrado). */
const SQUIRCLE_N = 4.6
/** Color de la losa: ascua arriba, ascua quemada abajo. */
const TILE_TOP = [228, 87, 46]
const TILE_BOTTOM = [190, 60, 27]
/** Tinta de la marca: blanco cálido, nunca blanco puro. */
const INK = [255, 245, 237]
/** Trazo del latido en el lienzo de 1024. */
const STROKE = 48
/**
 * Trazado, en coordenadas del lienzo (y hacia abajo). La forma de un latido de
 * verdad —línea base, muesca Q, pico R, valle S y vuelta a la base— y no una
 * onda cualquiera: el pico es el punto más alto y el valle baja por debajo de la
 * línea, que es lo que hace que el ojo lo lea como un pulso.
 */
const TRACE = [
  [148, 512],
  [392, 512],
  [430, 556],
  [470, 344],
  [512, 668],
  [552, 512],
  [876, 512],
]

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** true si (x,y) cae dentro de la superelipse inscrita en el lienzo. */
function insideSquircle(x, y, size) {
  const half = size / 2
  const nx = (x - half) / half
  const ny = (y - half) / half
  return Math.pow(Math.abs(nx), SQUIRCLE_N) + Math.pow(Math.abs(ny), SQUIRCLE_N) <= 1
}

/** Distancia mínima de un punto a un segmento. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const lengthSquared = vx * vx + vy * vy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSquared))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

/** true si (x,y) cae sobre el trazo del latido. */
function onTrace(x, y, size, stroke) {
  const scale = size / DESIGN
  const half = (stroke * scale) / 2
  for (let index = 0; index < TRACE.length - 1; index += 1) {
    const [ax, ay] = TRACE[index].map((value) => value * scale)
    const [bx, by] = TRACE[index + 1].map((value) => value * scale)
    if (distanceToSegment(x, y, ax, ay, bx, by) <= half) return true
  }
  return false
}

/**
 * Grosor del trazo para un tamaño dado: proporcional, pero engordado en los
 * tamaños pequeños donde el detalle fino se pierde.
 */
function strokeFor(size) {
  if (size <= 20) return STROKE * 1.35
  if (size <= 32) return STROKE * 1.24
  if (size <= 48) return STROKE * 1.14
  if (size <= 64) return STROKE * 1.07
  return STROKE
}

/** RGBA de un icono cuadrado de `size` píxeles. */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const samples = size <= 64 ? 4 : 3
  const step = 1 / samples
  const offset = step / 2
  const total = samples * samples
  const stroke = strokeFor(size)

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let inside = 0
      let ink = 0
      let red = 0
      let green = 0
      let blue = 0

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = px + offset + sx * step
          const y = py + offset + sy * step
          if (!insideSquircle(x, y, size)) continue
          inside += 1

          // Degradado vertical con un brillo tenue arriba: da volumen sin
          // ensuciar el color.
          const t = Math.pow(y / size, 0.85)
          const sheen = 0.05 * Math.pow(1 - t, 2)
          const base = mix(mix(TILE_TOP, TILE_BOTTOM, t), [255, 255, 255], sheen)

          if (onTrace(x, y, size, stroke)) {
            ink += 1
            red += INK[0]
            green += INK[1]
            blue += INK[2]
          } else {
            red += base[0]
            green += base[1]
            blue += base[2]
          }
        }
      }

      const index = (py * size + px) * 4
      if (inside === 0) {
        rgba[index] = 0
        rgba[index + 1] = 0
        rgba[index + 2] = 0
        rgba[index + 3] = 0
        continue
      }
      rgba[index] = Math.round(red / inside)
      rgba[index + 1] = Math.round(green / inside)
      rgba[index + 2] = Math.round(blue / inside)
      // Alfa por cobertura: la silueta queda suavizada aunque el color no lo esté.
      rgba[index + 3] = Math.round((inside / total) * 255)
      void ink
    }
  }
  return rgba
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // 8 bits por canal
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0 // filtro «none»
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── ICO e ICNS ──────────────────────────────────────────────────────────────

/** ICO con las entradas en PNG (formato que entienden Windows Vista y posteriores). */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icono
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length
  entries.forEach((entry, index) => {
    const base = index * 16
    // 0 significa 256 en este campo.
    directory[base] = entry.size >= 256 ? 0 : entry.size
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size
    directory[base + 2] = 0
    directory[base + 3] = 0
    directory.writeUInt16LE(1, base + 4)
    directory.writeUInt16LE(32, base + 6)
    directory.writeUInt32LE(entry.data.length, base + 8)
    directory.writeUInt32LE(offset, base + 12)
    offset += entry.data.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)])
}

/** ICNS con los tipos clásicos (icp4-6) y los modernos (ic07-ic14). */
const ICNS_TYPES = {
  16: 'icp4',
  32: 'icp5',
  64: 'icp6',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10',
}

function encodeIcns(entries) {
  const parts = []
  for (const entry of entries) {
    const type = ICNS_TYPES[entry.size]
    if (!type) continue
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(entry.data.length + 8, 4)
    parts.push(header, entry.data)
  }
  const body = Buffer.concat(parts)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// ── SVG y marca para la interfaz ─────────────────────────────────────────────

/**
 * Contorno de la superelipse como trazado SVG. Se muestrea en vez de escribirlo a
 * mano para que el vector y el mapa de bits salgan de la misma fórmula: si
 * cambia el exponente, cambian los dos a la vez y no se separan nunca.
 */
function squirclePath(size, steps = 96) {
  const half = size / 2
  const exponent = 2 / SQUIRCLE_N
  const points = []
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const x = half + half * Math.sign(cos) * Math.pow(Math.abs(cos), exponent)
    const y = half + half * Math.sign(sin) * Math.pow(Math.abs(sin), exponent)
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return `M ${points.join(' L ')} Z`
}

function svgSource() {
  const gradientId = 'latido-tile'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DESIGN} ${DESIGN}" width="${DESIGN}" height="${DESIGN}" role="img" aria-label="Latido">
  <!-- Generado por scripts/make-icons.mjs: no lo edites a mano. -->
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e4572e"/>
      <stop offset="1" stop-color="#be3c1b"/>
    </linearGradient>
  </defs>
  <path d="${squirclePath(DESIGN)}" fill="url(#${gradientId})"/>
  <polyline points="${TRACE.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="#fff5ed" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`
}

/** Constantes de la marca como módulo de TypeScript, para la interfaz. */
function tsSource() {
  return `/**
 * Geometría de la marca. **Generado por \`scripts/make-icons.mjs\`**: no lo
 * edites a mano. La interfaz dibuja exactamente la misma forma que el icono, así
 * que el logo de la cabecera no se puede quedar desfasado del de la app.
 */

export const MARK_VIEWBOX = '0 0 ${DESIGN} ${DESIGN}'

export const MARK_SQUIRCLE = '${squirclePath(DESIGN)}'

export const MARK_TRACE: readonly [number, number][] = [
${TRACE.map(([x, y]) => `  [${x}, ${y}],`).join('\n')}
]

export const MARK_STROKE = ${STROKE}
`
}

// ── ejecución ───────────────────────────────────────────────────────────────

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
mkdirSync(outDir, { recursive: true })

const rendered = new Map()
for (const size of SIZES) {
  const png = encodePng(size, renderIcon(size))
  rendered.set(size, png)
  writeFileSync(join(outDir, `${size}x${size}.png`), png)
}

// Nombres que espera el empaquetador por convención.
writeFileSync(join(outDir, '32x32.png'), rendered.get(32))
writeFileSync(join(outDir, '128x128.png'), rendered.get(128))
writeFileSync(join(outDir, '128x128@2x.png'), rendered.get(256))
writeFileSync(join(outDir, '256x256.png'), rendered.get(256))
writeFileSync(join(outDir, '512x512.png'), rendered.get(512))
writeFileSync(join(outDir, 'icon.png'), rendered.get(1024))

writeFileSync(
  join(outDir, 'icon.ico'),
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: rendered.get(size) }))),
)
writeFileSync(
  join(outDir, 'icon.icns'),
  encodeIcns([16, 32, 64, 128, 256, 512, 1024].map((size) => ({ size, data: rendered.get(size) }))),
)

// La marca también vive fuera del icono: en la documentación y en la interfaz.
const brandDir = join(here, '..', 'docs', 'brand')
mkdirSync(brandDir, { recursive: true })
writeFileSync(join(brandDir, 'logo.svg'), svgSource())
writeFileSync(join(brandDir, 'logo.png'), rendered.get(1024))
writeFileSync(join(here, '..', 'apps', 'app', 'src', 'components', 'logo-path.ts'), tsSource())

console.log(`iconos: ${SIZES.length} PNG + icon.ico + icon.icns → ${outDir}`)
console.log('marca: docs/brand/logo.svg, docs/brand/logo.png y logo-path.ts para la interfaz')
