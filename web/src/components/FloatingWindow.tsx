import { useEffect, useRef, useState, type ReactNode } from 'react'

interface FloatingWindowProps {
  open: boolean
  /** Dim the page behind the window (default true). */
  dim?: boolean
  /** Close on backdrop click (default false — dismiss only via explicit buttons). */
  closeOnBackdrop?: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Centered floating window over a dimmed backdrop. Fades + slides in from the
 * top on open, and reverses out to the top before unmounting on close.
 */
export function FloatingWindow({ open, dim = true, closeOnBackdrop = false, onClose, children }: FloatingWindowProps) {
  // stays mounted while the close animation plays
  const [render, setRender] = useState(open)
  // cleared once the open animation finishes so will-change and animation are
  // removed — iOS Safari flickers when forwards fill-mode releases the layer
  const [openDone, setOpenDone] = useState(false)

  // freeze the last open-state content & dim during the exit animation, so the
  // window fades away intact even if props change (e.g. welcome → edit)
  const lastChildren = useRef(children)
  const lastDim = useRef(dim)
  if (open) {
    lastChildren.current = children
    lastDim.current = dim
  }

  useEffect(() => {
    if (open) { setRender(true); setOpenDone(false) }
  }, [open])

  if (!render) return null

  const cardAnim = openDone && open
    ? 'none'
    : open
      ? 'ws-drop-in 300ms ease-in-out forwards'
      : 'ws-drop-out 380ms ease-in-out forwards'

  return (
    <div
      onClick={closeOnBackdrop ? onClose : undefined}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[4.5rem]"
      style={{
        background: (open ? dim : lastDim.current) ? 'rgba(0, 0, 0, 0.4)' : 'transparent',
        // composite the fade on the GPU — repainting a fullscreen dim over the
        // blurred body blobs tanks the frame rate otherwise
        willChange: 'opacity',
        // same duration as the window so the dim never disappears before the card does
        animation: open
          ? 'ws-fade-in 300ms ease-in-out forwards'
          : 'ws-fade-out 380ms ease-in-out forwards',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return
          if (!open) setRender(false)
          else setOpenDone(true)
        }}
        className="w-full max-w-sm rounded-[var(--radius)] p-4"
        style={{
          // elevated surface: near-white in light mode; in dark mode a lifted gray
          // that's brighter than its border so the card pops off the backdrop
          background: 'var(--float-bg)',
          border: '1px solid var(--float-border)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.45), 0 10px 30px rgba(0, 0, 0, 0.12)',
          willChange: openDone && open ? 'auto' : 'transform, opacity',
          animation: cardAnim,
        }}
      >
        {open ? children : lastChildren.current}
      </div>
    </div>
  )
}
