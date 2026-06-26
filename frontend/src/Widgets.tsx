import { useEffect, useState } from 'react'
import type { KioskConfig } from './config'

// Live "now", refreshed on an interval (1s for the clock, slower for the date).
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function ClockWidget() {
  const now = useNow(1000)
  const h = now.getHours() % 12 || 12
  const m = String(now.getMinutes()).padStart(2, '0')
  const date = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  return (
    <div className="glass widget widget-clock">
      <div className="widget-clock__time">
        {h}:{m}
      </div>
      <div className="widget-clock__date">{date}</div>
    </div>
  )
}

function CalendarWidget() {
  const now = useNow(30000)
  const monthYear = now.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })
  const weekday = now.toLocaleDateString(undefined, { weekday: 'short' })
  return (
    <div className="glass widget widget-calendar">
      <div className="widget-calendar__monthyear">{monthYear}</div>
      <div className="widget-calendar__day">{now.getDate()}</div>
      <div className="widget-calendar__weekday">{weekday}</div>
    </div>
  )
}

// Position a widget by its x/y%. The translate(-x%, -y%) keeps it fully on-screen
// at any position: anchor slides from the widget's top-left (0) to bottom-right (100).
export function slotStyle(p: { x: number; y: number }): React.CSSProperties {
  return {
    left: `${p.x}%`,
    top: `${p.y}%`,
    transform: `translate(${-p.x}%, ${-p.y}%)`,
  }
}

// The overlay layer: renders enabled widgets at their positions, on top of the
// active mode. pointer-events: none so it never blocks anything underneath.
export default function Widgets({ config }: { config: KioskConfig }) {
  const { clock, calendar } = config.widgets
  return (
    <div className="widget-layer">
      {clock.enabled && (
        <div className="widget-slot" style={slotStyle(clock)}>
          <ClockWidget />
        </div>
      )}
      {calendar.enabled && (
        <div className="widget-slot" style={slotStyle(calendar)}>
          <CalendarWidget />
        </div>
      )}
    </div>
  )
}
