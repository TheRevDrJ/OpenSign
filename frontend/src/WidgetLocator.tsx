import { useEffect, useRef, useState } from 'react'
import {
  getBibleStatus,
  mediaSrc,
  pickFile,
  saveBibleKey,
  syncClock,
  type BibleStatus,
} from './api'
import type {
  KioskConfig,
  CountdownConfig,
  GivingConfig,
  VerseConfig,
  WidgetSize,
} from './config'
import { resolveVerse, slotStyle, verseDayIndex, type ShownVerse } from './Widgets'

// Snap grid is orientation-aware: 15 points either way (5×3 landscape, 3×5
// portrait). Odd × odd → a true centre; endpoints included → true corners and
// edges. Every drop lands on a point (no free placement). The widget-layer's
// margin (kiosk.css) keeps corner widgets a tidy gap off the screen edge.
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
const edges = (n: number) =>
  n <= 1 ? [50] : Array.from({ length: n }, (_, i) => (i / (n - 1)) * 100)
const nearest = (v: number, points: number[]) =>
  points.reduce((best, p) => (Math.abs(p - v) < Math.abs(best - v) ? p : best), points[0])

type Which = 'clock' | 'calendar' | 'countdown' | 'giving' | 'verse'
const ALL: Which[] = ['clock', 'calendar', 'countdown', 'giving', 'verse']
const LABEL: Record<Which, string> = {
  clock: 'Clock',
  calendar: 'Calendar',
  countdown: 'Countdown',
  giving: 'Giving',
  verse: 'Verse',
}
const SIZES: { id: WidgetSize; label: string }[] = [
  { id: 'sm', label: 'S' },
  { id: 'md', label: 'M' },
  { id: 'lg', label: 'L' },
  { id: 'xl', label: 'XL' },
]

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
      // Don't let widgets share a spot — block a move onto a cell another holds.
      const clash = ALL.some(
        (other) =>
          other !== which &&
          cfg.widgets[other].enabled &&
          cfg.widgets[other].x === x &&
          cfg.widgets[other].y === y,
      )
      if (clash) return
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

  // Merge a partial into one widget's config (size, and countdown's label/target).
  const patchWidget = (
    which: Which,
    p: Partial<CountdownConfig & GivingConfig & VerseConfig>,
  ) =>
    patch({
      widgets: {
        ...config.widgets,
        [which]: { ...config.widgets[which], ...p },
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

  // API.Bible: this install's key (never shown back) and the Bibles it unlocks.
  // BSB is built in and always offered.
  const [bible, setBible] = useState<BibleStatus>({ keySet: false, bibles: [], error: '' })
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  // Language only filters the Translation list; the saved choice is the Bible id.
  const [lang, setLang] = useState('')
  const currentLang =
    lang || bible.bibles.find((b) => b.id === config.widgets.verse.translation)?.lang || 'eng'
  useEffect(() => {
    getBibleStatus().then(setBible)
  }, [])
  // Today's verse as the screens show it, so Skip removes the right one.
  const [today, setToday] = useState<ShownVerse | null>(null)
  const verseCfg = config.widgets.verse
  const skipped = verseCfg.skipped ?? []
  const skipKey = skipped.join(',')
  const useServerClock = config.clockSource !== 'device'
  useEffect(() => {
    if (!verseCfg.enabled) return
    let alive = true
    syncClock().then(() =>
      resolveVerse(verseDayIndex(useServerClock), verseCfg.translation, skipKey ? skipKey.split(',') : []).then(
        (v) => alive && setToday(v),
      ),
    )
    return () => {
      alive = false
    }
  }, [verseCfg.enabled, verseCfg.translation, skipKey, useServerClock])

  const submitKey = async (key: string) => {
    setKeyBusy(true)
    const s = await saveBibleKey(key)
    setKeyBusy(false)
    setBible(s)
    if (!s.error) setKeyDraft('')
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
        <div className="os-seg" role="group" aria-label="Widget spacing">
          <button
            className={`os-seg-btn${!config.evenSpacing ? ' active' : ''}`}
            onClick={() => patch({ evenSpacing: false })}
          >
            Grid
          </button>
          <button
            className={`os-seg-btn${config.evenSpacing ? ' active' : ''}`}
            onClick={() => patch({ evenSpacing: true })}
          >
            Even spacing
          </button>
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

      {enabled.length > 0 && (
        <div className="os-widget-settings">
          {enabled.map((w) => (
            <div key={w} className="os-wset">
              <div className="os-wset__head">
                <span className="os-wset__name">{LABEL[w]}</span>
                <div className="os-seg os-seg--sm" role="group" aria-label="Size">
                  {SIZES.map((s) => (
                    <button
                      key={s.id}
                      className={`os-seg-btn${config.widgets[w].size === s.id ? ' active' : ''}`}
                      onClick={() => patchWidget(w, { size: s.id })}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {w === 'countdown' && (
                <div className="os-wset__fields">
                  <label className="os-field">
                    <span>Label</span>
                    <input
                      value={config.widgets.countdown.label}
                      placeholder="e.g. TIME UNTIL WORSHIP"
                      onChange={(e) =>
                        patchWidget('countdown', { label: e.target.value })
                      }
                    />
                  </label>
                  <label className="os-field">
                    <span>Counts down to</span>
                    <input
                      type="time"
                      value={config.widgets.countdown.target}
                      onChange={(e) =>
                        patchWidget('countdown', { target: e.target.value })
                      }
                    />
                  </label>
                </div>
              )}
              {w === 'verse' && (
                <div className="os-wset__fields">
                  {bible.keySet && (
                    <label className="os-field">
                      <span>Language</span>
                      <select value={currentLang} onChange={(e) => setLang(e.target.value)}>
                        {Object.entries(bible.languages ?? { eng: 'English' }).map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="os-field">
                    <span>Translation</span>
                    <select
                      value={config.widgets.verse.translation}
                      onChange={(e) => patchWidget('verse', { translation: e.target.value })}
                    >
                      <option value="BSB">BSB (built in)</option>
                      {bible.bibles.filter((b) => b.lang === currentLang).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.abbr} — {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="os-today">
                    <span className="os-today__text">
                      Today: <strong>{today ? `${today.ref} (${today.version})` : '…'}</strong>
                    </span>
                    <button
                      className="os-pick-btn os-today__btn"
                      disabled={!today}
                      onClick={() =>
                        today && patchWidget('verse', { skipped: [...skipped, today.osis] })
                      }
                    >
                      Skip this verse
                    </button>
                  </div>
                  {skipped.length > 0 && (
                    <button
                      className="os-pick-btn"
                      onClick={() => patchWidget('verse', { skipped: [] })}
                    >
                      Restore skipped ({skipped.length})
                    </button>
                  )}
                  <label className="os-field">
                    <span>
                      API.Bible key {bible.keySet ? '(saved)' : '(not saved)'}{' '}
                      <span
                        className="os-info"
                        data-tip="Free key from api.bible: sign up for the Starter plan, pick up to three translations, then copy your key from your account and paste it here. It also unlocks their free Bibles."
                      >
                        i
                      </span>
                    </span>
                    <input
                      type="password"
                      value={keyDraft}
                      placeholder={bible.keySet ? 'Enter a new key to replace it' : 'Paste your key'}
                      onChange={(e) => setKeyDraft(e.target.value)}
                    />
                  </label>
                  <div className="os-wset__row">
                    <button
                      className="os-pick-btn"
                      disabled={keyBusy || !keyDraft.trim()}
                      onClick={() => submitKey(keyDraft)}
                    >
                      {keyBusy ? 'Checking…' : 'Save key'}
                    </button>
                    {bible.keySet && (
                      <button className="os-pick-btn" disabled={keyBusy} onClick={() => submitKey('')}>
                        Remove key
                      </button>
                    )}
                  </div>
                  {bible.error && <span className="os-wset__error">{bible.error}</span>}
                </div>
              )}
              {w === 'giving' && (
                <div className="os-wset__fields">
                  <button
                    className="os-pick-btn"
                    onClick={async () => {
                      const p = await pickFile()
                      if (p) patchWidget('giving', { image: p })
                    }}
                  >
                    Pick QR image…
                  </button>
                  {config.widgets.giving.image && (
                    <img
                      className="os-preview"
                      src={mediaSrc(config.widgets.giving.image)}
                      alt=""
                    />
                  )}
                  <label className="os-field">
                    <span>Caption</span>
                    <input
                      value={config.widgets.giving.label}
                      placeholder="e.g. SCAN TO GIVE"
                      onChange={(e) =>
                        patchWidget('giving', { label: e.target.value })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
