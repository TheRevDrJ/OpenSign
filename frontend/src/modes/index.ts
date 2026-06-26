// The mode registry. Adding a display mode = write the component, then add one
// row here. Everything else (kiosk render, admin mode-picker) reads this list.

import type { ModeId } from '../config'
import type { ModeDef } from './types'
import TextMode from './TextMode'
import ImagesMode from './ImagesMode'
import StopMode from './StopMode'

export type { ModeProps, ModeDef } from './types'

export const MODES: ModeDef[] = [
  {
    id: 'text',
    label: 'Text',
    description: 'A text card — logo, headline, and a line.',
    component: TextMode,
  },
  {
    id: 'images',
    label: 'Images',
    description: 'A single image, or a slideshow rotating a folder.',
    component: ImagesMode,
  },
  {
    id: 'stop',
    label: 'Stand By',
    description: 'Standby — a black screen with the server status, showing nothing.',
    component: StopMode,
  },
]

export function getMode(id: ModeId): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}
