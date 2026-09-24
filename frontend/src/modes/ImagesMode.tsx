import { useEffect, useState } from 'react'
import { listFolder, mediaSrc, serverNow } from '../api'
import type { ImagesFit } from '../config'
import type { ModeProps } from './types'

// Mode: Images — one still image, or a slideshow rotating a folder. Both render
// full-bleed; `fit` (contain/cover/fill) controls how each fills the screen.
export default function ImagesMode({ config }: ModeProps) {
  const { kind, fit, image, folder, intervalMs } = config.images

  if (kind === 'slideshow') {
    return <Slideshow folder={folder} intervalMs={intervalMs} fit={fit} />
  }

  // Single still image.
  if (!image) {
    return (
      <div className="mode-images">
        <p className="mode-images__hint">No image set — choose one in admin.</p>
      </div>
    )
  }
  return (
    <div className="mode-images mode-images--full">
      <img
        className="mode-images__img"
        style={{ objectFit: fit }}
        src={mediaSrc(image)}
        alt=""
      />
    </div>
  )
}

// Its own component so its hooks always run (no conditional hooks in the parent).
function Slideshow({
  folder,
  intervalMs,
  fit,
}: {
  folder: string
  intervalMs: number
  fit: ImagesFit
}) {
  const [files, setFiles] = useState<string[]>([])
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    let alive = true
    if (!folder) {
      setFiles([])
      return
    }
    listFolder(folder).then((r) => {
      if (alive) setFiles(r.files)
    })
    return () => {
      alive = false
    }
  }, [folder])

  // Sync across displays WITHOUT a server push: derive the index from the shared
  // SERVER clock (serverNow(), fed by /api/time — see api.ts), so every display
  // on the same folder+interval lands on the same image at the same instant, even
  // if their local machine clocks drift a few seconds apart. A display that joins
  // or reconnects mid-cycle jumps straight to the current image, in step — no
  // per-machine counter that restarts at 0. The tick re-aligns to each period
  // boundary (on server time) so flips are simultaneous, not phase-shifted.
  useEffect(() => {
    const period = Math.max(1000, intervalMs)
    if (files.length < 2) {
      setIdx(0)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setIdx(Math.floor(serverNow() / period) % files.length)
      timer = setTimeout(tick, period - (serverNow() % period) + 20)
    }
    tick()
    return () => clearTimeout(timer)
  }, [files, intervalMs])

  if (!folder) {
    return (
      <div className="mode-images">
        <p className="mode-images__hint">No folder set — choose one in admin.</p>
      </div>
    )
  }
  if (files.length === 0) {
    return (
      <div className="mode-images">
        <p className="mode-images__hint">
          No images found in <strong>{folder}</strong>.
        </p>
      </div>
    )
  }
  return (
    <div className="mode-images mode-images--full">
      <img
        className="mode-images__img"
        style={{ objectFit: fit }}
        src={mediaSrc(`${folder}/${files[idx]}`)}
        alt=""
      />
    </div>
  )
}
