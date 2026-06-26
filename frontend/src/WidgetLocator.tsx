import { useEffect, useRef, useState } from 'react'
import type { KioskConfig } from './config'
import { slotStyle } from './Widgets'

// Snap grid is orientation-aware: 15 points either way (5×3 landscape, 3×5
// portrait). Odd × odd → a true centre; endpoints included → true corners and
// edges. Every drop lands on a point (no free placement). The widget-layer's
// margin (kiosk.css) keeps corner widgets a tidy gap off the screen edge.
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
const edges = (n: number) =>
  n <= 1 ? [50] : Array.from({ length: n }, (_, i) => (i / (n - 1)) * 100)
const nearest = (v: number, points: number[]) =>
  points.reduce((best, p) => (Math.abs(p - v) < Math.abs(best - v) ? p : best), points[0])

type Which = 'clock' | 'calendar'
const ALL: Which[] = ['clock', 'calendar']
const LABEL: Record<Which, string> = { clock: 'Clock', calendar: 'Calendar' }

// A 16:9 representation of the screen, oriented by the manual toggle so a portrait
// wall can be laid out from a landscape desk.
const LONG = 360
const SHORT = Math.round((LONG * 9) / 16)

// Drag a widget from the tray onto the screen to place it; drag a placed widget
// to move it; right-click a placed widget to remove it.
export default function WidgetLocator({
  config,
  patch,
}: {
  config: KioskConfig
  patch: (p: Partial<KioskConfig>) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Which | null>(null)
  const cfgRef = useRef(config)
  cfgRef.current = config
  const [drag, setDrag] = useState<Which | null>(null)
  const [menu, setMenu] = useState<{ which: Which; x: number; y: number } | null>(
    null,
  )

  const portrait = config.orientation === 'portrait'
  const boxDim = portrait ? { w: SHORT, h: LONG } : { w: LONG, h: SHORT }

  // Orientation-aware snap points — 5×3 when wide, 3×5 when tall. Kept in a ref so
  // the drag handler (registered once) always reads the current grid.
  const xSnaps = edges(portrait ? 3 : 5)
  const ySnaps = edges(portrait ? 5 : 3)
  const snapsRef = useRef({ x: xSnaps, y: ySnaps })
  snapsRef.current = { x: xSnaps, y: ySnaps }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const which = dragRef.current
      const box = boxRef.current?.getBoundingClientRect()
      if (!which || !box) return
      const grid = snapsRef.current
      const x = nearest(clamp(((e.clientX - box.left) / box.width) * 100), grid.x)
      const y = nearest(clamp(((e.clientY - box.top) / box.height) * 100), grid.y)
      const cfg = cfgRef.current
      // Don't let the two widgets share a spot — block a move onto the other's cell.
      const other = which === 'clock' ? 'calendar' : 'clock'
      const o = cfg.widgets[other]
      if (o.enabled && o.x === x && o.y === y) return
      patch({
        widgets: { ...cfg.widgets, [which]: { ...cfg.widgets[which], x, y } },
      })
    }
    const onUp = () => {
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [patch])

  // Close the context menu on any outside pointer-press or key.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const enable = (which: Which, on: boolean) =>
    patch({
      widgets: {
        ...cfgRef.current.widgets,
        [which]: { ...cfgRef.current.widgets[which], enabled: on },
      },
    })

  // Begin dragging an already-placed widget (left button only).
  const startMove = (which: Which) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = which
    setDrag(which)
  }

  // Begin placing a tray widget: enable it, then drag it onto the grid.
  const startPlace = (which: Which) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    enable(which, true)
    dragRef.current = which
    setDrag(which)
  }

  const enabled = ALL.filter((w) => config.widgets[w].enabled)
  const available = ALL.filter((w) => !config.widgets[w].enabled)

  return (
    <div className="os-widgets">
      <div className="os-widgets__bar">
        <div className="os-tray">
          {available.length > 0 ? (
            available.map((w) => (
              <button
                key={w}
                className="os-tray__chip"
                onPointerDown={startPlace(w)}
              >
                {LABEL[w]}
              </button>
            ))
          ) : (
            <span className="os-tray__empty">All widgets placed.</span>
          )}
        </div>
        <div className="os-seg" role="group" aria-label="Screen orientation">
          <button
            className={`os-seg-btn${!portrait ? ' active' : ''}`}
            onClick={() => patch({ orientation: 'landscape' })}
          >
            Landscape
          </button>
          <button
            className={`os-seg-btn${portrait ? ' active' : ''}`}
            onClick={() => patch({ orientation: 'portrait' })}
          >
            Portrait
          </button>
        </div>
      </div>

      <div className="os-locator" style={{ width: boxDim.w, height: boxDim.h }}>
        <div className="os-locator__field" ref={boxRef}>
          {xSnaps.flatMap((sx) =>
            ySnaps.map((sy) => (
              <span
                key={`${sx}-${sy}`}
                className="os-locator__snap"
                style={{ left: `${sx}%`, top: `${sy}%` }}
              />
            )),
          )}
          {enabled.map((w) => (
            <div
              key={w}
              className={`os-locator__marker${drag === w ? ' dragging' : ''}`}
              style={slotStyle(config.widgets[w])}
              onPointerDown={startMove(w)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ which: w, x: e.clientX, y: e.clientY })
              }}
            >
              {LABEL[w]}
            </div>
          ))}
          {enabled.length === 0 && (
            <span className="os-locator__hint">Drag a widget here</span>
          )}
        </div>
      </div>

      <p className="os-widgets__hint">
        Drag a widget onto the screen to place it · right-click a placed widget to
        remove it.
      </p>

      {menu && (
        <div
          className="os-ctxmenu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className="os-ctxmenu__item"
            onClick={() => {
              enable(menu.which, false)
              setMenu(null)
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
