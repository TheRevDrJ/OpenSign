import type { ModeProps } from './types'

// Mode: Text — logo + headline + a line, centered.
export default function TextMode({ config }: ModeProps) {
  const { headline, subtext, showLogo } = config.text
  return (
    <div className="mode-text">
      {showLogo && (
        <img className="mode-text__logo" src="/opensign-logo.svg" alt="" />
      )}
      {headline && <h1 className="mode-text__headline">{headline}</h1>}
      {subtext && <p className="mode-text__subtext">{subtext}</p>}
    </div>
  )
}
