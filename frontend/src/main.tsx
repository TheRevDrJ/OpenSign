import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/theme.css'
import Kiosk from './Kiosk'
import Admin from './Admin'

// Two "pages" on one app: / is the kiosk display, /admin is the control panel.
// No router dep — just branch on the path (works under Vite's SPA fallback in
// dev and the backend's SPA fallback in production).
const path = window.location.pathname.replace(/\/+$/, '')
const isAdmin = path.endsWith('/admin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdmin ? <Admin /> : <Kiosk />}</StrictMode>,
)
