import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  getBibleVerse,
  mediaSrc,
  reportView,
  serverNow,
  serverTzOffsetMinutes,
} from './api'
import type { KioskConfig, WidgetSize } from './config'
import { VERSES, VERSION_LABEL, verseIndexForDate } from './data/verses'

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

// Verse of the day. The verse is picked deterministically from the day number of
// the SAME clock-shifted Date the other time widgets use, so every display shows
// the same verse and it rolls over at the chosen wall-clock midnight — no server
// push. The day's pick comes from the bundled list; another translation is
// fetched by the server (API.Bible, the church's own key) for that reference.
// Version-agnostic length rule: whatever version is showing, a verse too long for
// the card is skipped for the NEXT one in the list, in that same version (the
// chosen version is never swapped; deterministic, so every display agrees).
// Only a failure (no key, offline) shows the BSB instead.
function VerseWidget({
  useServer,
  translation,
  skipped,
}: {
  useServer: boolean
  translation: string
  skipped: string[]
}) {
  const now = useNow(60_000, useServer) // a minute is plenty for a daily verse
  const dayIndex = verseIndexForDate(now)
  const skipKey = skipped.join(',')
  const [shown, setShown] = useState<ShownVerse>(() => bsbPick(dayIndex, skipped))
  useEffect(() => {
    let alive = true
    const skip = skipKey ? skipKey.split(',') : []
    setShown(bsbPick(dayIndex, skip))
    resolveVerse(dayIndex, translation, skip).then((v) => {
      if (!alive) return
      setShown(v)
      if (v.fums) reportView(v.fums)
    })
    return () => {
      alive = false
    }
  }, [translation, dayIndex, skipKey])
  const { ref, text, version } = shown
  const fit = useFitText(text)
  return (
    <div className="glass widget widget-verse">
      <div className="widget-verse__box" ref={fit.boxRef}>
        {/* invisible sample that sets the box height: the space a
            SAMPLE_CHARS-long verse needs at full font on this screen */}
        <div className="widget-verse__text widget-verse__probe" ref={fit.probeRef} aria-hidden>
          {FIT_SAMPLE}
        </div>
        <div className="widget-verse__text" ref={fit.textRef}>
          {text}
        </div>
      </div>
      <div className="widget-verse__ref">
        {ref}
        <span className="widget-verse__version">{version}</span>
      </div>
    </div>
  )
}

// The verse card has a MAXIMUM size for each S/M/L/XL, so no verse can push it
// into its neighbours: its text may be at most as tall as FIT_SAMPLE needs at
// full font (measured live, so it holds on any screen). A longer verse shrinks
// its font until it fits, down to FIT_MIN; then the box hugs the text, so there
// is no empty space above or below it. gen_verses.py's length cap keeps every
// verse above that floor. @decision:gold 2026-09-23 — 120 chars fit at XL.
const FIT_SAMPLE =
  'This is a sample line one hundred and twenty characters long, the most a verse may show at full size on the card itself.'
const FIT_MIN = 0.7
// Longest text the card holds at FIT_MIN (checked by eye: 243 fits). A verse
// longer than this, in whatever version, is skipped for the next one.
const MAX_CHARS = 243
const MAX_SKIPS = 10

/** A verse as shown: the entry it came from (osis) plus the version's own text. */
export interface ShownVerse {
  osis: string
  ref: string
  text: string
  version: string
  fums?: string
}

/** BSB for a day: the day's entry, or the next one that isn't skipped and fits. */
function bsbPick(dayIndex: number, skipped: string[]): ShownVerse {
  for (let k = 0; k < VERSES.length; k++) {
    const v = VERSES[(dayIndex + k) % VERSES.length]
    if (!skipped.includes(v.osis) && v.text.length <= MAX_CHARS) {
      return { osis: v.osis, ref: v.ref, text: v.text, version: VERSION_LABEL }
    }
  }
  const v = VERSES[dayIndex]
  return { osis: v.osis, ref: v.ref, text: v.text, version: VERSION_LABEL }
}

/** What the verse widget shows for a day, in a version: the day's entry, or the
 *  next one that the church hasn't skipped and that fits the card IN THAT VERSION.
 *  Shared with admin, so its "today" line and Skip button match the screens.
 *  Only a failure (no key, offline) falls back to BSB. */
export async function resolveVerse(
  dayIndex: number,
  translation: string,
  skipped: string[],
): Promise<ShownVerse> {
  const bsb = bsbPick(dayIndex, skipped)
  if (!translation || translation === VERSION_LABEL) return bsb
  let fetches = 0
  for (let k = 0; k < VERSES.length && fetches < MAX_SKIPS; k++) {
    const v = VERSES[(dayIndex + k) % VERSES.length]
    if (skipped.includes(v.osis)) continue
    fetches++
    const got = await getBibleVerse(translation, v.osis, v.ref)
    if (!got) return bsb
    if (got.text.length <= MAX_CHARS) {
      return { osis: v.osis, ref: got.ref, text: got.text, version: got.abbr, fums: got.fums }
    }
  }
  return bsb
}

/** Today's position in the verse list, on the clock the widgets use. */
export function verseDayIndex(useServer: boolean): number {
  return verseIndexForDate(computeNow(useServer))
}
const FIT_STEP = 0.02

function useFitText(text: string) {
  const boxRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)
  // Re-fit when the window resizes or web fonts finish loading (metrics change).
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('resize', bump)
    document.fonts?.ready.then(bump).catch(() => {})
    return () => window.removeEventListener('resize', bump)
  }, [])
  useLayoutEffect(() => {
    const box = boxRef.current
    const probe = probeRef.current
    const el = textRef.current
    if (!box || !probe || !el) return
    // offset/scroll sizes are pre-transform, so the slot's scale() doesn't matter.
    const max = probe.offsetHeight
    box.style.height = `${max}px`
    let f = 1
    el.style.setProperty('--fit', '1')
    while (el.scrollHeight > max + 1 && f > FIT_MIN) {
      f = Math.max(FIT_MIN, f - FIT_STEP)
      el.style.setProperty('--fit', String(f))
    }
    box.style.height = `${Math.min(el.scrollHeight, max)}px`
  }, [text, tick])
  return { boxRef, probeRef, textRef }
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

type WidgetName = 'clock' | 'calendar' | 'countdown' | 'giving' | 'verse'
const WIDGET_NAMES: WidgetName[] = ['clock', 'calendar', 'countdown', 'giving', 'verse']

// Even spacing: widgets sharing a column (portrait) or a row (landscape) keep the
// first and last against the layer's edges and get EQUAL gaps between them, like
// flex space-between. Needed because the grid anchors each widget by its own
// edge or centre, so widgets of different heights leave unequal gaps. Sizes are
// MEASURED (a widget's size is its content times its S/M/L/XL scale, and the
// verse card changes with the day's verse), then each gets a px offset.
// @decision:gold 2026-09-23 — the first and last widgets stay against the edges;
// only the gaps between share out.
function evenSlotStyle(
  p: { x: number; y: number },
  scale: number,
  vertical: boolean,
  offset: number,
): React.CSSProperties {
  return vertical
    ? {
        left: `${p.x}%`,
        top: `${offset}px`,
        transformOrigin: `${p.x}% 0%`,
        transform: `translate(${-p.x}%, 0) scale(${scale})`,
      }
    : {
        left: `${offset}px`,
        top: `${p.y}%`,
        transformOrigin: `0% ${p.y}%`,
        transform: `translate(0, ${-p.y}%) scale(${scale})`,
      }
}

function useEvenSpacing(config: KioskConfig) {
  const layerRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Partial<Record<WidgetName, HTMLDivElement | null>>>({})
  const [offsets, setOffsets] = useState<Partial<Record<WidgetName, number>>>({})
  const vertical = config.orientation === 'portrait'
  const w = config.widgets
  const key = JSON.stringify([config.evenSpacing, vertical, WIDGET_NAMES.map((n) => w[n])])

  useLayoutEffect(() => {
    const layout = () => {
      const layer = layerRef.current?.getBoundingClientRect()
      const next: Partial<Record<WidgetName, number>> = {}
      if (config.evenSpacing && layer) {
        const groups = new Map<number, WidgetName[]>()
        for (const n of WIDGET_NAMES) {
          if (!w[n].enabled || !slotRefs.current[n]) continue
          const k = vertical ? w[n].x : w[n].y
          groups.set(k, [...(groups.get(k) ?? []), n])
        }
        for (const names of groups.values()) {
          if (names.length < 2) continue
          names.sort((a, b) => (vertical ? w[a].y - w[b].y : w[a].x - w[b].x))
          const sizes = names.map((n) => {
            const r = slotRefs.current[n]!.getBoundingClientRect()
            return vertical ? r.height : r.width
          })
          const span = vertical ? layer.height : layer.width
          const gap = (span - sizes.reduce((a, b) => a + b, 0)) / (names.length - 1)
          let pos = 0
          names.forEach((n, i) => {
            next[n] = Math.round(pos)
            pos += sizes[i] + gap
          })
        }
      }
      setOffsets((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    layout()
    // Re-space when any widget's content changes size (e.g. the verse) or the
    // window resizes. A position change never changes a size, so this settles.
    const ro = new ResizeObserver(layout)
    for (const n of WIDGET_NAMES) {
      const el = slotRefs.current[n]
      if (el) ro.observe(el)
    }
    window.addEventListener('resize', layout)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', layout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const style = (n: WidgetName): React.CSSProperties => {
    const scale = SIZE_SCALE[w[n].size]
    const off = offsets[n]
    return off === undefined ? slotStyle(w[n], scale) : evenSlotStyle(w[n], scale, vertical, off)
  }
  const ref = (n: WidgetName) => (el: HTMLDivElement | null) => {
    slotRefs.current[n] = el
  }
  return { layerRef, style, ref }
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
  const { clock, calendar, countdown, giving, verse } = config.widgets
  const useServer = config.clockSource !== 'device'
  const even = useEvenSpacing(config)
  return (
    <div className="widget-layer" ref={even.layerRef}>
      {clock.enabled && (
        <div className="widget-slot" ref={even.ref('clock')} style={even.style('clock')}>
          <ClockWidget useServer={useServer} />
        </div>
      )}
      {calendar.enabled && (
        <div className="widget-slot" ref={even.ref('calendar')} style={even.style('calendar')}>
          <CalendarWidget useServer={useServer} />
        </div>
      )}
      {countdown.enabled && (
        <div className="widget-slot" ref={even.ref('countdown')} style={even.style('countdown')}>
          <CountdownWidget
            label={countdown.label}
            target={countdown.target}
            onExpire={onCountdownExpire}
            useServer={useServer}
          />
        </div>
      )}
      {giving.enabled && (
        <div className="widget-slot" ref={even.ref('giving')} style={even.style('giving')}>
          <GivingWidget image={giving.image} label={giving.label} />
        </div>
      )}
      {verse.enabled && (
        <div className="widget-slot" ref={even.ref('verse')} style={even.style('verse')}>
          <VerseWidget
            useServer={useServer}
            translation={verse.translation}
            skipped={verse.skipped ?? []}
          />
        </div>
      )}
    </div>
  )
}
