import { useEffect, useState } from 'react'
import type { ModeProps } from './types'

// Mode: Stop — standby. Black screen, server-reachable status + "display off".
// Confirms the kiosk is alive and the backend is up, while showing nothing.
export default function StopMode(_props: ModeProps) {
  const [up, setUp] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const res = await fetch('/api/health')
        if (alive) setUp(res.ok)
      } catch {
        if (alive) setUp(false)
      }
    }
    check()
    const t = setInterval(check, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const status =
    up === null ? 'Checking…' : up ? 'Server up' : 'Server unreachable'
  const statusClass =
    up === null ? '' : up ? ' mode-stop__status--up' : ' mode-stop__status--down'

  return (
    <div className="mode-stop">
      <p className={`mode-stop__status${statusClass}`}>{status}</p>
      <p className="mode-stop__off">Display mode off</p>
    </div>
  )
}
