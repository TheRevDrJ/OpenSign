import { useEffect, useRef, useState } from 'react'
import { getConfig, saveConfig } from './api'
import { DEFAULT_CONFIG, type KioskConfig } from './config'
import { getMode } from './modes'
import Widgets from './Widgets'
import './styles/kiosk.css'

// The display side. Applies the theme, renders the active mode fullscreen, and
// re-polls config so changes made in /admin (from any device) appear on the wall.
export default function Kiosk() {
  const [config, setConfig] = useState<KioskConfig>(DEFAULT_CONFIG)
  const cfgRef = useRef(config)
  cfgRef.current = config

  // The countdown removes itself ~30s after hitting zero — Widgets fires this,
  // and we persist it (same effect as a right-click Remove) so it stays gone.
  const removeCountdown = () => {
    const c = cfgRef.current
    if (!c.widgets.countdown.enabled) return
    const next = {
      ...c,
      widgets: {
        ...c.widgets,
        countdown: { ...c.widgets.countdown, enabled: false },
      },
    }
    setConfig(next)
    saveConfig(next)
  }

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
      <Widgets config={config} onCountdownExpire={removeCountdown} />
    </div>
  )
}
