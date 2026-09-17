#!/usr/bin/env node
/**
 * Genera los iconos de la aplicación (PNG, ICO e ICNS) sin dependencias.
 *
 * Se dibuja la marca —el latido dentro de un cuadrado redondeado— por muestreo
 * de distancias y se codifica a PNG con zlib, que ya viene en Node. Determinista:
 * el mismo código produce los mismos bytes, así que el CI puede comprobarlo.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'apps', 'desktop', 'src-tauri', 'icons')

/** Color de fondo (ascua) y de la marca (tinta), en RGB 0-255. */
const BACKGROUND = [228, 87, 46]
const FOREGROUND = [26, 12, 7]
const CORNER_RADIUS = 14 / 64
const STROKE_WIDTH = 4.5 / 64
/** Trazado del latido en un lienzo de 64×64. */
const POLYLINE = [
  [10, 34],
  [18.5, 34],
  [24, 18],
  [32, 44],
  [37, 32],
  [54, 32],
]

const SAMPLES = 3 // supermuestreo por eje: bordes suaves sin difuminar

function roundedSquareCoverage(x, y, size) {
  const half = size / 2
  const radius = CORNER_RADIUS * size
  const dx = Math.abs(x - half) - (half - radius)
  const dy = Math.abs(y - half) - (half - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  const inside = outside - radius
  return inside <= 0
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const lengthSquared = vx * vx + vy * vy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared))
  const cx = ax + t * vx
  const cy = ay + t * vy
  return Math.hypot(px - cx, py - cy)
}

function strokeCoverage(x, y, size) {
  const scale = size / 64
  const half = (STROKE_WIDTH * size) / 2
  for (let index = 0; index < POLYLINE.length - 1; index += 1) {
    const [ax, ay] = POLYLINE[index].map((value) => value * scale)
    const [bx, by] = POLYLINE[index + 1].map((value) => value * scale)
    if (distanceToSegment(x, y, ax, ay, bx, by) <= half) return true
  }
  return false
}

/** Devuelve RGBA de un icono cuadrado de `size` píxeles. */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const step = 1 / SAMPLES
  const offset = step / 2

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let inside = 0
      let stroke = 0
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = px + offset + sx * step
          const y = py + offset + sy * step
          if (!roundedSquareCoverage(x, y, size)) continue
          inside += 1
          if (strokeCoverage(x, y, size)) stroke += 1
        }
      }
      const total = SAMPLES * SAMPLES
      const alpha = inside / total
      const mix = inside === 0 ? 0 : stroke / inside
      const index = (py * size + px) * 4
      const color = [
        Math.round(BACKGROUND[0] * (1 - mix) + FOREGROUND[0] * mix),
        Math.round(BACKGROUND[1] * (1 - mix) + FOREGROUND[1] * mix),
        Math.round(BACKGROUND[2] * (1 - mix) + FOREGROUND[2] * mix),
      ]
      rgba[index] = color[0]
      rgba[index + 1] = color[1]
      rgba[index + 2] = color[2]
      rgba[index + 3] = Math.round(alpha * 255)
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
  header[8] = 8 // bits por canal
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0 // filtro "none"
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

function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icono
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length
  entries.forEach((entry, index) => {
    const base = index * 16
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

const ICNS_TYPES = { 32: 'ic11', 64: 'ic12', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' }

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

// ── ejecución ───────────────────────────────────────────────────────────────

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
mkdirSync(outDir, { recursive: true })

const rendered = new Map()
for (const size of SIZES) {
  const png = encodePng(size, renderIcon(size))
  rendered.set(size, png)
  writeFileSync(join(outDir, `${size}x${size}.png`), png)
}

// Nombres que espera Tauri por convención.
writeFileSync(join(outDir, '32x32.png'), rendered.get(32))
writeFileSync(join(outDir, '128x128.png'), rendered.get(128))
writeFileSync(join(outDir, '128x128@2x.png'), rendered.get(256))
writeFileSync(join(outDir, 'icon.png'), rendered.get(1024))

writeFileSync(
  join(outDir, 'icon.ico'),
  encodeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: rendered.get(size) }))),
)
writeFileSync(
  join(outDir, 'icon.icns'),
  encodeIcns([32, 64, 128, 256, 512, 1024].map((size) => ({ size, data: rendered.get(size) }))),
)

console.log(`iconos: ${SIZES.length} PNG + icon.ico + icon.icns → apps/desktop/src-tauri/icons`)
