// Thin client for the OpenSign backend. Falls back to defaults when the backend
// isn't reachable (e.g. frontend running alone in dev) so the kiosk always renders.

import { DEFAULT_CONFIG, type KioskConfig } from './config'

// Deep-merge the nested groups so a config missing a newer key (e.g. images.fit,
// or an older saved layout file) still picks up its default.
function mergeConfig(loaded: Partial<KioskConfig>): KioskConfig {
  const w = loaded.widgets
  return {
    ...DEFAULT_CONFIG,
    ...loaded,
    text: { ...DEFAULT_CONFIG.text, ...loaded.text },
    images: { ...DEFAULT_CONFIG.images, ...loaded.images },
    widgets: {
      clock: { ...DEFAULT_CONFIG.widgets.clock, ...w?.clock },
      calendar: { ...DEFAULT_CONFIG.widgets.calendar, ...w?.calendar },
      countdown: { ...DEFAULT_CONFIG.widgets.countdown, ...w?.countdown },
      giving: { ...DEFAULT_CONFIG.widgets.giving, ...w?.giving },
    },
  }
}

export async function getConfig(): Promise<KioskConfig> {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return mergeConfig(await res.json())
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function saveConfig(config: KioskConfig): Promise<boolean> {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    return res.ok
  } catch {
    return false
  }
}

// --- Server-clock sync ------------------------------------------------------
// Displays derive the slideshow index from the SERVER's clock, not their own,
// so multiple screens stay in lockstep even when their machine clocks drift a
// few seconds apart (NTP keeps each near true time, but not near each other).

let clockOffset = 0 // serverNow - Date.now(), in ms
let serverTzOffsetMin = 0 // the server's current UTC offset, in minutes

/** Best estimate of the server's current time (epoch ms). */
export function serverNow(): number {
  return Date.now() + clockOffset
}

/** The server's current UTC offset in minutes — used to render "server time"
 *  in the server's timezone, so every display shows the same wall clock. */
export function serverTzOffsetMinutes(): number {
  return serverTzOffsetMin
}

/** Re-measure the offset to the server clock, correcting for round-trip time. */
export async function syncClock(): Promise<void> {
  try {
    const t0 = Date.now()
    const res = await fetch('/api/time')
    if (!res.ok) return
    const { now, offset } = await res.json()
    const t1 = Date.now()
    // server time at t1 ≈ now + half the round-trip
    clockOffset = now + (t1 - t0) / 2 - t1
    if (typeof offset === 'number') serverTzOffsetMin = offset
  } catch {
    // transient failure — keep the last known values
  }
}

/**
 * Turn a stored value into a loadable <img> src.
 * - a full web URL (http(s):// or data:) → use as-is
 * - anything else → a local filesystem path on the display machine, served in
 *   place via the backend. This includes BOTH macOS/Linux paths ("/Users/…")
 *   and Windows paths ("C:\…"); we must NOT treat a leading "/" as a server
 *   URL, or every absolute Unix path would bypass the backend and 404.
 */
export function mediaSrc(value: string): string {
  if (!value) return ''
  if (/^(?:https?:|data:)/i.test(value)) return value
  return `/api/localfile?path=${encodeURIComponent(value)}`
}

/** Save the current config to a .json the user picks (native Save dialog). */
export async function saveLayout(config: KioskConfig): Promise<string | null> {
  try {
    const res = await fetch('/api/layout/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) return null
    return (await res.json()).path ?? null
  } catch {
    return null
  }
}

/** Load a config from a .json the user picks (native Open dialog). */
export async function loadLayout(): Promise<KioskConfig | null> {
  try {
    const res = await fetch('/api/layout/load')
    if (!res.ok) return null
    const { config } = await res.json()
    return config ? mergeConfig(config) : null
  } catch {
    return null
  }
}

/** Open a native file dialog on the display machine; returns the chosen path. */
export async function pickFile(): Promise<string | null> {
  try {
    const res = await fetch('/api/pick/file')
    if (!res.ok) return null
    return (await res.json()).path ?? null
  } catch {
    return null
  }
}

/** Open a native folder dialog on the display machine; returns the chosen path. */
export async function pickFolder(): Promise<string | null> {
  try {
    const res = await fetch('/api/pick/folder')
    if (!res.ok) return null
    return (await res.json()).path ?? null
  } catch {
    return null
  }
}

/** List the image files in a local folder (for Cycle mode). */
export async function listFolder(
  path: string,
): Promise<{ folder: string; files: string[] }> {
  try {
    const res = await fetch(`/api/folder/list?path=${encodeURIComponent(path)}`)
    if (!res.ok) return { folder: path, files: [] }
    return await res.json()
  } catch {
    return { folder: path, files: [] }
  }
}
