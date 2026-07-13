import { useEffect, useRef, useState } from 'react'
import { mediaSrc, serverNow, serverTzOffsetMinutes } from './api'
import type { KioskConfig, WidgetSize } from './config'

// Predefined widget scales — the admin sets one of these per widget.
export const SIZE_SCALE: Record<WidgetSize, number> = {
  sm: 0.8,
  md: 1,
  lg: 1.5,
  xl: 2.5,
}

// Returns a Date deliberately SHIFTED so its UTC fields (getUTCHours,
// toLocale…({timeZone:'UTC'}), setUTCHours) read the intended WALL CLOCK:
//   server mode — the server's wall clock (its instant + its UTC offset), so
//     every display shows the same time regardless of its own timezone;
//   device mode — this machine's own local wall clock (unchanged behavior).
// Reading UTC-of-a-shifted-Date is how we render a chosen timezone without an
// IANA name; all the time widgets read UTC fields for exactly this reason.
function computeNow(useServer: boolean): Date {
  if (useServer) return new Date(serverNow() + serverTzOffsetMinutes() * 60000)
  const n = Date.now()
  return new Date(n - new Date(n).getTimezoneOffset() * 60000)
}

// Live "now" (shifted per computeNow), refreshed on an interval.
function useNow(intervalMs: number, useServer: boolean) {
  const [now, setNow] = useState(() => computeNow(useServer))
  useEffect(() => {
    setNow(computeNow(useServer))
    const t = setInterval(() => setNow(computeNow(useServer)), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs, useServer])
  return now
}

function ClockWidget({ useServer }: { useServer: boolean }) {
  const now = useNow(1000, useServer)
  const h = now.getUTCHours() % 12 || 12
  const m = String(now.getUTCMinutes()).padStart(2, '0')
  const date = now.toLocaleDateString(undefined, {
    timeZone: 'UTC',
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

function CalendarWidget({ useServer }: { useServer: boolean }) {
  const now = useNow(30000, useServer)
  const monthYear = now.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  })
  const weekday = now.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
  })
  return (
    <div className="glass widget widget-calendar">
      <div className="widget-calendar__monthyear">{monthYear}</div>
      <div className="widget-calendar__day">{now.getUTCDate()}</div>
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
  useServer,
}: {
  label: string
  target: string
  onExpire?: () => void
  useServer: boolean
}) {
  const now = useNow(1000, useServer)
  const [h, m] = target.split(':').map(Number)
  // `now` is shifted so its UTC fields are the chosen wall clock; set the target
  // time-of-day on that same frame. The now↔target difference is shift-invariant.
  const t = new Date(now)
  if (Number.isFinite(h) && Number.isFinite(m)) t.setUTCHours(h, m, 0, 0)
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

function GivingWidget({ image, label }: { image: string; label: string }) {
  return (
    <div className="glass widget widget-giving">
      {label && <div className="widget-giving__label">{label}</div>}
      {image && <img className="widget-giving__qr" src={mediaSrc(image)} alt="" />}
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
  const { clock, calendar, countdown, giving } = config.widgets
  const useServer = config.clockSource !== 'device'
  return (
    <div className="widget-layer">
      {clock.enabled && (
        <div className="widget-slot" style={slotStyle(clock, SIZE_SCALE[clock.size])}>
          <ClockWidget useServer={useServer} />
        </div>
      )}
      {calendar.enabled && (
        <div
          className="widget-slot"
          style={slotStyle(calendar, SIZE_SCALE[calendar.size])}
        >
          <CalendarWidget useServer={useServer} />
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
            useServer={useServer}
          />
        </div>
      )}
      {giving.enabled && (
        <div
          className="widget-slot"
          style={slotStyle(giving, SIZE_SCALE[giving.size])}
        >
          <GivingWidget image={giving.image} label={giving.label} />
        </div>
      )}
    </div>
  )
}
