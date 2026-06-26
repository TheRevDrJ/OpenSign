import { useEffect, useState } from 'react'
import { getConfig } from './api'
import { DEFAULT_CONFIG, type KioskConfig } from './config'
import { getMode } from './modes'
import Widgets from './Widgets'
import './styles/kiosk.css'

// The display side. Applies the theme, renders the active mode fullscreen, and
// re-polls config so changes made in /admin (from any device) appear on the wall.
export default function Kiosk() {
  const [config, setConfig] = useState<KioskConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const c = await getConfig()
      if (alive) setConfig(c)
    }
    load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const Mode = getMode(config.mode).component
  const rootClass = `os-root os-kiosk theme-${config.theme}${config.light ? ' mode-light' : ''}`

  return (
    <div className={rootClass}>
      <Mode config={config} />
      <Widgets config={config} />
    </div>
  )
}
