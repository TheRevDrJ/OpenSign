import { useEffect, useState } from 'react'
import { listFolder, mediaSrc } from '../api'
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
      if (alive) {
        setFiles(r.files)
        setIdx(0)
      }
    })
    return () => {
      alive = false
    }
  }, [folder])

  useEffect(() => {
    if (files.length < 2) return
    const t = setInterval(
      () => setIdx((i) => (i + 1) % files.length),
      Math.max(1000, intervalMs),
    )
    return () => clearInterval(t)
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
