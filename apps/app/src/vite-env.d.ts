/// <reference types="vite/client" />

declare module '*.css'
declare module '@latido/tokens/tokens.css'

/**
 * Compatibilidad de tipos: @types/react 19 movió `JSX` dentro de `React`.
 * Este alias global evita repetir el import en cada componente.
 */
import type { JSX as ReactJSX } from 'react'

declare global {
  namespace JSX {
    type Element = ReactJSX.Element
    type ElementType = ReactJSX.ElementType
    type IntrinsicElements = ReactJSX.IntrinsicElements
  }
}
