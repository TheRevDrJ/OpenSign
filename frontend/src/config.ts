// OpenSign shared config types + defaults.
// The backend persists a KioskConfig to data/config.json; the admin page edits
// it; the kiosk reads it and renders the matching mode.

export type ModeId = 'text' | 'images' | 'stop'
export type ImagesKind = 'single' | 'slideshow'
/** CSS object-fit: contain = letterbox, cover = fill+crop, fill = stretch. */
export type ImagesFit = 'contain' | 'cover' | 'fill'
export type ThemeId = 'honededge' | 'openvoice'
/** Display orientation — drives the admin widget-locator's shape (set manually,
 *  so a portrait wall can be laid out from a landscape desk). */
export type Orientation = 'landscape' | 'portrait'
/** Predefined widget sizes (the scale factors live in Widgets.tsx). */
export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl'

export interface TextConfig {
  headline: string
  subtext: string
  showLogo: boolean
}

export interface ImagesConfig {
  /** single = one still image; slideshow = rotate the images in a folder. */
  kind: ImagesKind
  /** how the image fills the screen. */
  fit: ImagesFit
  /** path/URL to the still image (kind === 'single'). */
  image: string
  /** folder of images to rotate (kind === 'slideshow'), resolved by the backend. */
  folder: string
  intervalMs: number
}

// Widgets are an OVERLAY, not a mode — each renders on top of whatever mode is
// running (e.g. a clock in the corner of a slideshow), independently toggled.
export interface WidgetConfig {
  enabled: boolean
  /** anchor position as screen percentages (0–100); the locator snaps to a 15-point grid. */
  x: number
  y: number
  /** predefined display size. */
  size: WidgetSize
}

/** The countdown widget adds a caption and a target time-of-day to count down to. */
export interface CountdownConfig extends WidgetConfig {
  /** caption above the timer, e.g. "TIME UNTIL WORSHIP". */
  label: string
  /** target time of day, 24h "HH:MM"; counts down to today's occurrence. */
  target: string
}

export interface WidgetsConfig {
  clock: WidgetConfig
  calendar: WidgetConfig
  countdown: CountdownConfig
}

export interface KioskConfig {
  mode: ModeId
  theme: ThemeId
  light: boolean
  orientation: Orientation
  text: TextConfig
  images: ImagesConfig
  widgets: WidgetsConfig
}

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'honededge', label: 'HonedEdge' },
  { id: 'openvoice', label: 'OpenVoice' },
]

export const DEFAULT_CONFIG: KioskConfig = {
  mode: 'text',
  theme: 'honededge',
  light: false,
  orientation: 'landscape',
  text: {
    headline: 'The Honed Edge',
    subtext: 'Wisdom helps one to succeed. — Ecclesiastes 10:10',
    showLogo: true,
  },
  images: {
    kind: 'single',
    fit: 'contain',
    image: '',
    folder: '',
    intervalMs: 8000,
  },
  widgets: {
    clock: { enabled: false, x: 100, y: 100, size: 'md' },
    calendar: { enabled: false, x: 100, y: 0, size: 'md' },
    countdown: {
      enabled: false,
      x: 50,
      y: 50,
      size: 'lg',
      label: 'TIME UNTIL WORSHIP',
      target: '10:45',
    },
  },
}
