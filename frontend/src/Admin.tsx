import { useEffect, useRef, useState } from 'react'
import {
  getConfig,
  saveConfig,
  saveLayout,
  loadLayout,
  pickFile,
  pickFolder,
  mediaSrc,
} from './api'
import { DEFAULT_CONFIG, THEMES, type KioskConfig } from './config'
import { MODES } from './modes'
import WidgetLocator from './WidgetLocator'
import './styles/admin.css'

type Tab = 'display' | 'widgets' | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'display', label: 'Display' },
  { id: 'widgets', label: 'Widgets' },
  { id: 'settings', label: 'Settings' },
]

// A checkbox styled as a slider switch (the real input stays underneath, so it's
// still keyboard-accessible).
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="os-toggle">
      <input
        type="checkbox"
        className="os-toggle__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="os-toggle__track" aria-hidden="true">
        <span className="os-toggle__thumb" />
      </span>
      <span className="os-toggle__label">{label}</span>
    </label>
  )
}

// The control side. Reachable at /admin from any device on the LAN. Edits the
// config and posts it; the kiosk picks it up on its next poll.
export default function Admin() {
  const [config, setConfig] = useState<KioskConfig>(DEFAULT_CONFIG)
  const [status, setStatus] = useState('')
  const [tab, setTab] = useState<Tab>('display')

  useEffect(() => {
    getConfig().then(setConfig)
  }, [])

  const patch = (p: Partial<KioskConfig>) => setConfig((c) => ({ ...c, ...p }))

  // Auto-save: persist a change shortly after it settles (a released drag, a
  // paused keystroke). No Save button — the display picks it up on its next poll.
  const firstRef = useRef(true)
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false
      return
    }
    const t = setTimeout(async () => {
      const ok = await saveConfig(config)
      setStatus(ok ? 'Saved ✓' : 'Could not reach the backend (:6101).')
    }, 400)
    return () => clearTimeout(t)
  }, [config])

  const rootClass = `os-root os-admin theme-${config.theme}${config.light ? ' mode-light' : ''}`

  return (
    <div className={rootClass}>
      <div className="os-admin__inner">
        <header className="os-admin__head">
          <img className="os-admin__logo" src="/opensign-logo.svg" alt="OpenSign" />
          <h1>OpenSign — Control</h1>
        </header>

        <nav className="os-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`os-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'display' && (
          <>
            <section className="os-card">
              <h2>Display mode</h2>
              <div className="os-pills">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    className={`os-pill${config.mode === m.id ? ' active' : ''}`}
                    onClick={() => patch({ mode: m.id })}
                  >
                    {m.label}
                    <span
                      className="os-info"
                      data-tip={m.description}
                      onClick={(e) => e.stopPropagation()}
                    >
                      i
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {config.mode === 'text' && (
              <section className="os-card">
                <h2>Text</h2>
                <label className="os-field">
                  <span>Headline</span>
                  <input
                    value={config.text.headline}
                    onChange={(e) =>
                      patch({ text: { ...config.text, headline: e.target.value } })
                    }
                  />
                </label>
                <label className="os-field">
                  <span>Subtext</span>
                  <input
                    value={config.text.subtext}
                    onChange={(e) =>
                      patch({ text: { ...config.text, subtext: e.target.value } })
                    }
                  />
                </label>
                <Toggle
                  checked={config.text.showLogo}
                  onChange={(v) => patch({ text: { ...config.text, showLogo: v } })}
                  label="Show logo"
                />
              </section>
            )}

            {config.mode === 'images' && (
              <section className="os-card">
                <h2>Images</h2>
                <div className="os-seg">
                  <button
                    className={`os-seg-btn${config.images.kind === 'single' ? ' active' : ''}`}
                    onClick={() => patch({ images: { ...config.images, kind: 'single' } })}
                  >
                    Single
                  </button>
                  <button
                    className={`os-seg-btn${config.images.kind === 'slideshow' ? ' active' : ''}`}
                    onClick={() =>
                      patch({ images: { ...config.images, kind: 'slideshow' } })
                    }
                  >
                    Slideshow
                  </button>
                </div>

                <label className="os-field">
                  <span>Fit</span>
                  <select
                    value={config.images.fit}
                    onChange={(e) =>
                      patch({
                        images: {
                          ...config.images,
                          fit: e.target.value as KioskConfig['images']['fit'],
                        },
                      })
                    }
                  >
                    <option value="contain">Contain — whole image, letterboxed</option>
                    <option value="cover">Cover — fill the screen, crop the edges</option>
                    <option value="fill">Stretch — fill exactly, distort</option>
                  </select>
                </label>

                {config.images.kind === 'single' ? (
                  <>
                    <button
                      className="os-pick-btn"
                      onClick={async () => {
                        setStatus('Opening picker on the display machine…')
                        const p = await pickFile()
                        if (p) {
                          patch({ images: { ...config.images, image: p } })
                          setStatus('')
                        } else {
                          setStatus('No file chosen.')
                        }
                      }}
                    >
                      Pick file…
                    </button>
                    {config.images.image && (
                      <img
                        className="os-preview"
                        src={mediaSrc(config.images.image)}
                        alt=""
                      />
                    )}
                    <label className="os-field">
                      <span>Path (or paste one)</span>
                      <input
                        value={config.images.image}
                        placeholder="C:\\OpenSign\\slide.png"
                        onChange={(e) =>
                          patch({ images: { ...config.images, image: e.target.value } })
                        }
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <button
                      className="os-pick-btn"
                      onClick={async () => {
                        setStatus('Opening picker on the display machine…')
                        const p = await pickFolder()
                        if (p) {
                          patch({ images: { ...config.images, folder: p } })
                          setStatus('')
                        } else {
                          setStatus('No folder chosen.')
                        }
                      }}
                    >
                      Pick folder…
                    </button>
                    <label className="os-field">
                      <span>Folder (on the display machine — or paste a path)</span>
                      <input
                        value={config.images.folder}
                        placeholder="e.g. C:\\OpenSign\\slides"
                        onChange={(e) =>
                          patch({ images: { ...config.images, folder: e.target.value } })
                        }
                      />
                    </label>
                    <label className="os-field">
                      <span>Seconds per image</span>
                      <input
                        type="number"
                        min={1}
                        value={Math.round(config.images.intervalMs / 1000)}
                        onChange={(e) =>
                          patch({
                            images: {
                              ...config.images,
                              intervalMs: Number(e.target.value) * 1000,
                            },
                          })
                        }
                      />
                    </label>
                  </>
                )}
              </section>
            )}
          </>
        )}

        {tab === 'widgets' && (
          <section className="os-card">
            <h2>Widgets</h2>
            <WidgetLocator config={config} patch={patch} />
          </section>
        )}

        {tab === 'settings' && (
          <section className="os-card">
            <h2>Settings</h2>
            <label className="os-field">
              <span>Theme</span>
              <select
                value={config.theme}
                onChange={(e) => patch({ theme: e.target.value as KioskConfig['theme'] })}
              >
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="os-toggles">
              <Toggle
                checked={config.light}
                onChange={(v) => patch({ light: v })}
                label="Light mode"
              />
              <Toggle
                checked={config.keepAwake}
                onChange={(v) => patch({ keepAwake: v })}
                label="Keep display awake"
              />
            </div>
            <p className="os-tip">
              On the display, press <kbd>F11</kbd> (or launch the browser with{' '}
              <code>--kiosk</code>) for true fullscreen.
            </p>
          </section>
        )}

        <div className="os-admin__actions">
          <button
            className="os-pick-btn"
            onClick={async () => {
              setStatus('Choose where to save…')
              const path = await saveLayout(config)
              setStatus(path ? `Layout saved to ${path}` : 'Save cancelled.')
            }}
          >
            Save layout…
          </button>
          <button
            className="os-pick-btn"
            onClick={async () => {
              setStatus('Choose a layout file…')
              const loaded = await loadLayout()
              if (loaded) {
                setConfig(loaded)
                setStatus('Layout loaded — applied to the display.')
              } else {
                setStatus('Load cancelled.')
              }
            }}
          >
            Load layout…
          </button>
          <span className="os-status">
            {status ||
              'Changes save automatically — the display updates within a few seconds.'}
          </span>
        </div>
      </div>
    </div>
  )
}
