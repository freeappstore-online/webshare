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
 * top on open, and reverses out to the top before hiding safely on close.
 */
export function FloatingWindow({ open, dim = true, closeOnBackdrop = false, onClose, children }: FloatingWindowProps) {
  // stays active while the close animation plays
  const [render, setRender] = useState(open)

  // freeze the last open-state content & dim during the exit animation, so the
  // window fades away intact even if props change (e.g. welcome → edit)
  const lastChildren = useRef(children)
  const lastDim = useRef(dim)
  if (open) {
    lastChildren.current = children
    lastDim.current = dim
  }

  useEffect(() => {
    if (open) setRender(true)
  }, [open])

  // NEVER return null. Unmounting from the DOM is what causes the Safari flash.
  // We keep it mounted, but hide it visually and disable clicks.

  return (
    <div
      onClick={closeOnBackdrop ? onClose : undefined}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[4.5rem]"
      style={{
        background: (open ? dim : lastDim.current) ? 'rgba(0, 0, 0, 0.4)' : 'transparent',
        // Safe hiding without destroying the DOM node
        visibility: render ? 'visible' : 'hidden',
        pointerEvents: render ? 'auto' : 'none',
        // Removed will-change: opacity. Safari optimizes this natively now.
        animation: open
          ? 'ws-fade-in 300ms ease-in-out forwards'
          : render
            ? 'ws-fade-out 380ms ease-in-out forwards'
            : 'none',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return
          if (!open) setRender(false)
        }}
        className="w-full max-w-sm rounded-[var(--radius)] p-4"
        style={{
          background: 'var(--float-bg)',
          border: '1px solid var(--float-border)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.45), 0 10px 30px rgba(0, 0, 0, 0.12)',
          animation: open
            ? 'ws-drop-in 300ms ease-in-out forwards'
            : render
              ? 'ws-drop-out 380ms ease-in-out forwards'
              : 'none',
        }}
      >
        {open ? children : lastChildren.current}
      </div>
    </div>
  )
}
