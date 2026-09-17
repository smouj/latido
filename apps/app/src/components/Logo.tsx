import { MARK_SQUIRCLE, MARK_STROKE, MARK_TRACE, MARK_VIEWBOX } from '@/components/logo-path'

/** Tinta de la marca: el mismo blanco cálido que usa el icono. */
const INK = '#fff5ed'

/**
 * La marca de Latido: la losa y el latido.
 *
 * La geometría viene de `logo-path.ts`, que genera el mismo script que produce
 * los iconos (`scripts/make-icons.mjs`). Así el logo de la cabecera y el icono
 * del sistema no pueden separarse: son la misma forma.
 */
export function Logo({ size = 30, title = 'Latido' }: { size?: number; title?: string }): JSX.Element {
  const points = MARK_TRACE.map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      role="img"
      aria-label={title}
      focusable="false"
      className="logo"
    >
      <defs>
        <linearGradient id="latido-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4572e" />
          <stop offset="1" stopColor="#be3c1b" />
        </linearGradient>
      </defs>
      <path d={MARK_SQUIRCLE} fill="url(#latido-tile)" />
      <polyline
        points={points}
        fill="none"
        stroke={INK}
        strokeWidth={MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
