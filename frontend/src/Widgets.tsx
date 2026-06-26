import { useEffect, useRef, useState } from 'react'
import type { KioskConfig, WidgetSize } from './config'

// Predefined widget scales — the admin sets one of these per widget.
export const SIZE_SCALE: Record<WidgetSize, number> = {
  sm: 0.8,
  md: 1,
  lg: 1.5,
  xl: 2.5,
}

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

const pad = (n: number) => String(n).padStart(2, '0')
const GRACE_MS = 30_000 // keep the countdown up this long after it reaches zero

function CountdownWidget({
  label,
  target,
  onExpire,
}: {
  label: string
  target: string
  onExpire?: () => void
}) {
  const now = useNow(1000)
  const [h, m] = target.split(':').map(Number)
  const t = new Date(now)
  if (Number.isFinite(h) && Number.isFinite(m)) t.setHours(h, m, 0, 0)
  const totalSec = Math.max(0, Math.floor((t.getTime() - now.getTime()) / 1000))

  // Auto-remove GRACE_MS after the timer hits zero — but only if it actually
  // counted down here, so placing one whose time already passed won't vanish.
  const wasLive = useRef(false)
  const fired = useRef(false)
  if (totalSec > 0) wasLive.current = true
  useEffect(() => {
    if (
      onExpire &&
      wasLive.current &&
      !fired.current &&
      now.getTime() >= t.getTime() + GRACE_MS
    ) {
      fired.current = true
      onExpire()
    }
  }, [now, t, onExpire])

  const hrs = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  const display =
    hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`
  const flashing = totalSec === 0 && wasLive.current
  return (
    <div className="glass widget widget-countdown">
      {label && <div className="widget-countdown__label">{label}</div>}
      <div
        className={`widget-countdown__time${flashing ? ' widget-countdown__time--flash' : ''}`}
      >
        {display}
      </div>
    </div>
  )
}

// Position a widget by its x/y%. The translate(-x%, -y%) keeps it fully on-screen
// at any position (anchor slides from top-left at 0 to bottom-right at 100), and
// the optional scale grows it AWAY from that anchor, so it never spills off the
// edge it's pinned to.
export function slotStyle(
  p: { x: number; y: number },
  scale = 1,
): React.CSSProperties {
  return {
    left: `${p.x}%`,
    top: `${p.y}%`,
    transformOrigin: `${p.x}% ${p.y}%`,
    transform: `translate(${-p.x}%, ${-p.y}%) scale(${scale})`,
  }
}

// The overlay layer: renders enabled widgets at their positions, on top of the
// active mode. pointer-events: none so it never blocks anything underneath.
export default function Widgets({
  config,
  onCountdownExpire,
}: {
  config: KioskConfig
  onCountdownExpire?: () => void
}) {
  const { clock, calendar, countdown } = config.widgets
  return (
    <div className="widget-layer">
      {clock.enabled && (
        <div className="widget-slot" style={slotStyle(clock, SIZE_SCALE[clock.size])}>
          <ClockWidget />
        </div>
      )}
      {calendar.enabled && (
        <div
          className="widget-slot"
          style={slotStyle(calendar, SIZE_SCALE[calendar.size])}
        >
          <CalendarWidget />
        </div>
      )}
      {countdown.enabled && (
        <div
          className="widget-slot"
          style={slotStyle(countdown, SIZE_SCALE[countdown.size])}
        >
          <CountdownWidget
            label={countdown.label}
            target={countdown.target}
            onExpire={onCountdownExpire}
          />
        </div>
      )}
    </div>
  )
}
