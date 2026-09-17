export type ThemeName = 'dark' | 'light'

export interface Palette {
  readonly graphite: Record<string, string>
  readonly paper: Record<string, string>
  readonly ember: Record<string, string>
  readonly support: Record<string, string>
  readonly source: Record<string, string>
}

export interface SemanticTheme {
  bg: string
  surface: string
  raised: string
  inset: string
  overlay: string
  border: string
  borderStrong: string
  text: string
  textMuted: string
  textFaint: string
  accent: string
  accentHover: string
  accentFg: string
  accentSoft: string
  accentLine: string
  positive: string
  warning: string
  danger: string
  info: string
  selection: string
  focus: string
  skeleton: string
  shadow1: string
  shadow2: string
}

export interface Tokens {
  palette: Palette
  theme: Record<ThemeName, SemanticTheme>
  typography: {
    family: { ui: string; mono: string }
    size: Record<string, string>
    leading: Record<string, string>
    tracking: Record<string, string>
    weight: Record<string, string>
  }
  space: Record<string, string>
  radius: Record<string, string>
  border: Record<string, string>
  motion: {
    duration: Record<string, string>
    ease: Record<string, string>
  }
  layout: Record<string, string>
  z: Record<string, string>
  breakpoint: Record<string, string>
  data: { series: readonly string[]; grid: string }
}

export declare const palette: Palette
export declare const theme: Record<ThemeName, SemanticTheme>
export declare const typography: Tokens['typography']
export declare const space: Record<string, string>
export declare const radius: Record<string, string>
export declare const border: Record<string, string>
export declare const motion: Tokens['motion']
export declare const layout: Record<string, string>
export declare const z: Record<string, string>
export declare const breakpoint: Record<string, string>
export declare const data: Tokens['data']
export declare const tokens: Tokens

export default tokens
