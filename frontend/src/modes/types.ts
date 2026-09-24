import type { FC } from 'react'
import type { KioskConfig, ModeId } from '../config'

/** Every mode component receives the whole config and renders fullscreen. */
export interface ModeProps {
  config: KioskConfig
}

export interface ModeDef {
  id: ModeId
  label: string
  description: string
  component: FC<ModeProps>
}
