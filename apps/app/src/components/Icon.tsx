/**
 * Iconos.
 *
 * Un solo juego de trazo, 24×24, `currentColor`. Sin dependencias externas:
 * pesan menos que un paquete de iconos y no hay sorpresas de licencia.
 */
import type { SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'flame'
  | 'radar'
  | 'users'
  | 'compass'
  | 'search'
  | 'bookmark'
  | 'bell'
  | 'layers'
  | 'radio'
  | 'settings'
  | 'refresh'
  | 'external'
  | 'copy'
  | 'check'
  | 'close'
  | 'sun'
  | 'moon'
  | 'globe'
  | 'plus'
  | 'sparkles'
  | 'clock'
  | 'trend'
  | 'activity'
  | 'chevronRight'
  | 'chevronDown'
  | 'pause'
  | 'database'
  | 'shield'
  | 'rss'
  | 'star'
  | 'reply'
  | 'repeat'
  | 'info'
  | 'eye'
  | 'trash'
  | 'download'
  | 'upload'
  | 'command'
  | 'pulse'

const PATHS: Record<IconName, JSX.Element> = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  flame: (
    <path d="M12 3c.8 2.6-.4 4-1.6 5.2C9.2 9.4 8 10.8 8 13a4 4 0 0 0 8 0c0-1.4-.5-2.4-1.2-3.3-.4 1-.9 1.5-1.6 1.9.6-2.9-.4-5.4-1.2-6.6z" />
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 18 6.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3.6 19c.6-3 2.8-4.6 5.4-4.6S13.8 16 14.4 19" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 14.6c2 .5 3.3 1.9 3.7 4.4" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m14.8 9.2-1.6 4.2-4.2 1.6 1.6-4.2z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  bookmark: <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.6L6 20V5a1 1 0 0 1 1-1Z" />,
  bell: (
    <>
      <path d="M6.5 17V11a5.5 5.5 0 0 1 11 0v6" />
      <path d="M4.8 17h14.4M10 20h4" />
    </>
  ),
  layers: <path d="M12 4 3.5 8.2 12 12.4l8.5-4.2zM3.5 12.4 12 16.6l8.5-4.2M3.5 16.4 12 20.6l8.5-4.2" />,
  radio: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4M5 5a10 10 0 0 0 0 14M19 19a10 10 0 0 0 0-14" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.5v2M12 18.5v2M4.9 7.5l1.7 1M17.4 15.5l1.7 1M4.9 16.5l1.7-1M17.4 8.5l1.7-1" />
    </>
  ),
  refresh: <path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />,
  external: <path d="M14 5h5v5M19 5l-7.5 7.5M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.4 3.4 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.4-5.4-3.4-8.5S9.6 5.9 12 3.5Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sparkles: <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  trend: <path d="M3.5 17.5 9 12l3.5 3.5L20 8M20 8h-5M20 8v5" />,
  activity: <path d="M3.5 12h3.2l2.3-6 3.4 12 2.5-7.5h5.6" />,
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronDown: <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  pause: <path d="M9 5.5v13M15 5.5v13" />,
  database: (
    <>
      <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
      <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </>
  ),
  shield: <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6z" />,
  rss: (
    <>
      <circle cx="6.5" cy="17.5" r="1.6" />
      <path d="M4.5 10.5a9 9 0 0 1 9 9M4.5 5.5a14 14 0 0 1 14 14" />
    </>
  ),
  star: <path d="m12 4 2.4 5.3 5.6.6-4.2 3.8 1.2 5.6L12 16.4 7 19.3l1.2-5.6L4 9.9l5.6-.6z" />,
  reply: <path d="M20 17.5c0-4.4-3.6-8-8-8H5.5M9 5.5 5 9.5l4 4" />,
  repeat: <path d="M6 8.5h11l-2.5-2.5M18 15.5H7l2.5 2.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6 6.5 12 6.5 21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13M10.5 11v6M13.5 11v6" />,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />,
  upload: <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 19.5h15" />,
  command: <path d="M8.5 4.5a2.5 2.5 0 1 0 0 5h7a2.5 2.5 0 1 1 0 5h-7a2.5 2.5 0 1 0 2.5 2.5v-11A2.5 2.5 0 0 0 8.5 4.5Z" />,
  pulse: <path d="M3 12.5h3.5L9 6l3.5 12L15 12.5h6" />,
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: 'sm' | 'md' | 'lg'
}

export function Icon({ name, size = 'md', className, ...rest }: IconProps): JSX.Element {
  const classes = ['icon', size === 'sm' ? 'icon--sm' : size === 'lg' ? 'icon--lg' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}

/** Marca de Latido: el latido dentro de un cuadrado. */
export function BrandMark({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12.5h3.6L9.2 6.5l3.3 11 2.1-5h6.4"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
