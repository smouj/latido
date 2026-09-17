import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Tipografías empaquetadas: la app funciona sin conexión y sin CDNs de fuentes.
import '@fontsource-variable/manrope'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import '@latido/tokens/tokens.css'
import '@/styles/base.css'

import { App } from '@/App'

const container = document.getElementById('root')
if (!container) throw new Error('falta el contenedor #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
