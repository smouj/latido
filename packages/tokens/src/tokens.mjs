/**
 * Latido — sistema de diseño.
 *
 * Este archivo es la ÚNICA fuente de verdad de los tokens. `scripts/build.mjs`
 * lo consume y emite `dist/tokens.css` (variables CSS) y `dist/tokens.json`.
 * Ningún componente debe escribir un color, tamaño o duración literal:
 * siempre a través de `var(--token)`.
 *
 * Identidad: "Grafito y ascua". Superficies neutras cálidas, un único acento
 * naranja-ascua, métricas en monoespaciada. Nada de morados, cian neón ni
 * degradados de cristal: eso es el uniforme de la IA, no una decisión.
 */

/** Colores crudos. Nunca se usan directamente en componentes: ver `theme`. */
export const palette = {
  graphite: {
    950: '#0E0D0C',
    900: '#131110',
    850: '#1A1816',
    800: '#221F1C',
    700: '#2E2A26',
    600: '#3E3833',
    500: '#57504A',
    400: '#6F675C',
    300: '#A69C8F',
    200: '#CFC7B9',
    100: '#F4F0E9',
  },
  paper: {
    950: '#EDE7DC',
    900: '#F6F2EA',
    850: '#FFFDF9',
    800: '#FFFFFF',
    700: '#DFD7C9',
    600: '#C9BFAD',
    500: '#948B7C',
    400: '#6A6255',
    300: '#4A443B',
    200: '#1B1917',
    100: '#100F0E',
  },
  ember: {
    700: '#AD3A14',
    600: '#C7461D',
    500: '#E4572E',
    400: '#F0683E',
    300: '#F58A62',
  },
  support: {
    sage: '#7BA96B',
    sageInk: '#3F7A4A',
    amber: '#D9A343',
    amberInk: '#9C6E22',
    clay: '#C4453C',
    clayInk: '#A93A32',
    slate: '#6E93A8',
    slateInk: '#47697D',
  },
  source: {
    bluesky: '#4A9BE0',
    reddit: '#E86A3C',
    mastodon: '#8C6FD4',
    hackernews: '#E0932F',
    rss: '#7FA35C',
    github: '#9AA0A6',
    youtube: '#D0453C',
    lemmy: '#6FA96B',
  },
}

/**
 * Tokens semánticos por tema. La clave es el significado, no el color:
 * `bg`, `surface`, `text`, `accent`… Cambiar de tema nunca debe requerir
 * tocar un componente.
 */
export const theme = {
  dark: {
    bg: palette.graphite[900],
    surface: palette.graphite[850],
    raised: palette.graphite[800],
    inset: palette.graphite[950],
    overlay: 'rgba(9, 8, 7, 0.72)',
    border: palette.graphite[700],
    borderStrong: palette.graphite[600],
    text: palette.graphite[100],
    textMuted: palette.graphite[300],
    textFaint: palette.graphite[400],
    accent: palette.ember[500],
    accentHover: palette.ember[400],
    accentFg: '#1A0C07',
    accentSoft: 'rgba(228, 87, 46, 0.14)',
    accentLine: 'rgba(228, 87, 46, 0.34)',
    positive: palette.support.sage,
    warning: palette.support.amber,
    danger: palette.support.clay,
    info: palette.support.slate,
    selection: 'rgba(228, 87, 46, 0.22)',
    focus: palette.ember[400],
    skeleton: palette.graphite[800],
    shadow1: '0 1px 2px rgba(0, 0, 0, 0.4)',
    shadow2: '0 10px 30px -12px rgba(0, 0, 0, 0.7)',
  },
  light: {
    bg: palette.paper[900],
    surface: palette.paper[850],
    raised: palette.paper[800],
    inset: palette.paper[950],
    overlay: 'rgba(28, 26, 23, 0.42)',
    border: palette.paper[700],
    borderStrong: palette.paper[600],
    text: palette.paper[200],
    textMuted: palette.paper[400],
    textFaint: palette.paper[500],
    accent: palette.ember[600],
    accentHover: palette.ember[700],
    accentFg: '#FFF7F2',
    accentSoft: 'rgba(199, 70, 29, 0.10)',
    accentLine: 'rgba(199, 70, 29, 0.30)',
    positive: palette.support.sageInk,
    warning: palette.support.amberInk,
    danger: palette.support.clayInk,
    info: palette.support.slateInk,
    selection: 'rgba(199, 70, 29, 0.16)',
    focus: palette.ember[600],
    skeleton: palette.paper[950],
    shadow1: '0 1px 2px rgba(28, 26, 23, 0.08)',
    shadow2: '0 12px 32px -16px rgba(28, 26, 23, 0.28)',
  },
}

/** Escala tipográfica. `display` y `title` son fluidos (clamp). */
export const typography = {
  family: {
    ui: '"Manrope Variable", Manrope, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  size: {
    '2xs': '0.6875rem',
    xs: '0.75rem',
    sm: '0.8125rem',
    base: '0.875rem',
    md: '0.9375rem',
    lg: '1.0625rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    display: 'clamp(1.75rem, 1.2rem + 2vw, 2.5rem)',
  },
  leading: {
    tight: '1.15',
    snug: '1.3',
    normal: '1.5',
    relaxed: '1.65',
  },
  tracking: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.02em',
    caps: '0.08em',
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
}

/** Espaciado: base 4. Solo estos valores en layout. */
export const space = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
}

export const radius = {
  xs: '4px',
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '18px',
  pill: '999px',
}

export const border = {
  hairline: '1px',
  thick: '2px',
  focus: '2px',
}

export const motion = {
  duration: {
    instant: '90ms',
    fast: '140ms',
    base: '200ms',
    slow: '320ms',
    pulse: '1800ms',
  },
  ease: {
    standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    in: 'cubic-bezier(0.7, 0, 0.84, 0)',
    spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  },
}

/** Medidas de estructura. El layout de 3 columnas vive aquí.
 *  Son fluidas a propósito: la ventana se adapta al ancho disponible en lugar de
 *  quedarse con columnas rígidas que obligan a hacer scroll. */
export const layout = {
  nav: 'clamp(13.5rem, 12.5vw, 16rem)',
  rail: 'clamp(16rem, 21vw, 21rem)',
  header: '3.25rem',
  content: 'clamp(32rem, 44vw, 44rem)',
  wide: '60rem',
  tabbar: '3.5rem',
  sidebarFilter: 'none',
}

export const z = {
  base: '0',
  raised: '10',
  sticky: '20',
  nav: '30',
  overlay: '40',
  modal: '50',
  toast: '60',
  tooltip: '70',
}

export const breakpoint = {
  sm: '40rem',
  md: '56rem',
  lg: '72rem',
  xl: '88rem',
}

/** Tokens de datos: se usan en gráficas, barras y series. */
export const data = {
  series: [
    palette.ember[500],
    palette.support.sage,
    palette.source.bluesky,
    palette.support.amber,
    palette.source.mastodon,
    palette.support.slate,
  ],
  grid: 'color-mix(in srgb, currentColor 12%, transparent)',
}

/**
 * Los tres temas oficiales, uno por sistema.
 *
 * La marca no cambia —el ascua sigue siendo el acento y la tipografía de datos
 * sigue siendo monoespaciada—, pero cada tema adopta las maneras del sistema en
 * el que vive: radios, densidad, familia tipográfica, elevación y temperatura del
 * neutro. Así, en Windows parece de Windows y en macOS de macOS, sin dejar de ser
 * Latido. Las claves de color pisan a las del tema base.
 */
export const platforms = {
  windows: {
    label: 'Windows',
    hint: 'Radios cortos, densidad compacta y tipografía Segoe: el aspecto de Windows 11.',
    family: {
      ui: '"Segoe UI Variable Text", "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif',
    },
    radius: { xs: '2px', sm: '4px', md: '6px', lg: '8px', xl: '10px' },
    /** Menos aire: en Windows las listas son más densas. 1 = sin cambios. */
    density: '0.94',
    dark: {
      bg: '#0F1113',
      surface: '#16191C',
      raised: '#1D2126',
      inset: '#0A0C0E',
      border: '#2A2F35',
      borderStrong: '#3A414A',
      text: '#F2F4F7',
      textMuted: '#A8B0BA',
      textFaint: '#7C848E',
      controlHighlight: 'rgba(255, 255, 255, 0.07)',
      shadow1: '0 1px 2px rgba(0, 0, 0, 0.34)',
      shadow2: '0 8px 24px -10px rgba(0, 0, 0, 0.6)',
    },
    light: {
      bg: '#F3F3F3',
      surface: '#FBFBFB',
      raised: '#FFFFFF',
      inset: '#EAEAEA',
      border: '#DCDCDC',
      borderStrong: '#C4C4C4',
      text: '#1B1B1B',
      textMuted: '#5C6169',
      textFaint: '#7E848C',
      controlHighlight: 'rgba(255, 255, 255, 0.6)',
      shadow1: '0 1px 2px rgba(0, 0, 0, 0.08)',
      shadow2: '0 10px 28px -14px rgba(0, 0, 0, 0.24)',
    },
  },
  macos: {
    label: 'macOS',
    hint: 'Radios generosos, aire y tipografía del sistema: el aspecto de macOS.',
    family: {
      ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
    },
    radius: { xs: '5px', sm: '7px', md: '10px', lg: '14px', xl: '18px' },
    density: '1',
    dark: {
      // Neutro cálido (el de siempre) y elevación suave y amplia.
      controlHighlight: 'rgba(255, 255, 255, 0.05)',
      shadow1: '0 1px 2px rgba(0, 0, 0, 0.4)',
      shadow2: '0 10px 30px -12px rgba(0, 0, 0, 0.7)',
    },
    light: {
      controlHighlight: 'rgba(255, 255, 255, 0.7)',
      shadow1: '0 1px 2px rgba(28, 26, 23, 0.08)',
      shadow2: '0 12px 32px -16px rgba(28, 26, 23, 0.28)',
    },
  },
  linux: {
    label: 'Linux',
    hint: 'Plano y con filos marcados, tipografía Cantarell: el aspecto de GNOME.',
    family: {
      ui: 'Cantarell, Inter, Ubuntu, "Noto Sans", system-ui, "Helvetica Neue", Arial, sans-serif',
    },
    radius: { xs: '4px', sm: '6px', md: '9px', lg: '12px', xl: '16px' },
    /** Un poco más de aire y de altura de fila. */
    density: '1.04',
    dark: {
      bg: '#121212',
      surface: '#1B1B1D',
      raised: '#232326',
      inset: '#0C0C0C',
      border: '#303034',
      borderStrong: '#3E3E44',
      text: '#F6F5F4',
      textMuted: '#B0AEAB',
      textFaint: '#85837F',
      controlHighlight: 'transparent',
      // GNOME no abusa de la sombra: casi plana, con el filo haciendo el trabajo.
      shadow1: 'none',
      shadow2: '0 2px 8px -4px rgba(0, 0, 0, 0.4)',
    },
    light: {
      bg: '#FAFAFA',
      surface: '#FFFFFF',
      raised: '#FFFFFF',
      inset: '#F0F0F0',
      border: '#DEDEDE',
      borderStrong: '#C0C0C0',
      text: '#1D1D1D',
      textMuted: '#5E5E5E',
      textFaint: '#838383',
      controlHighlight: 'transparent',
      shadow1: 'none',
      shadow2: '0 2px 8px -4px rgba(0, 0, 0, 0.22)',
    },
  },
}

/** Identificador de tema de plataforma. `base` es el aspecto neutro de Latido. */
export const PLATFORM_NAMES = ['windows', 'macos', 'linux']

export const tokens = { palette, theme, platforms, PLATFORM_NAMES, typography, space, radius, border, motion, layout, z, breakpoint, data }

export default tokens
