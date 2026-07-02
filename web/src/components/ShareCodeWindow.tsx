import { CloseIcon } from './icons'
import { FloatingWindow } from './FloatingWindow'
import { QrImage } from './QrImage'

interface ShareCodeWindowProps {
  open: boolean
  code: string | null
  onClose: () => void
}

/** Mobile sender flow: the 6-digit code + QR for the receiver to enter or scan. */
export function ShareCodeWindow({ open, code, onClose }: ShareCodeWindowProps) {
  return (
    <FloatingWindow open={open} closeOnBackdrop onClose={onClose}>
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <h2 className="text-xl font-bold text-[var(--ink)]">Share Code</h2>
        {/* pl matches the tracking so the trailing letter-space doesn't skew centering */}
        <p className="pl-[0.3em] text-4xl font-bold tracking-[0.3em] text-[var(--ink)]">{code}</p>
        {code && (
          <QrImage
            code={code}
            className="w-60 max-w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-white p-2"
          />
        )}
        <p className="text-sm text-[var(--muted)]">
          On the other device, tap “Receive files…” and enter this code — or scan the QR.
          They'll appear in your people list once connected.
        </p>
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mb-1 flex cursor-pointer items-center justify-center self-center rounded-full p-2 text-[var(--muted)] transition-colors hover:bg-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <CloseIcon size={20} />
        </button>
      </div>
    </FloatingWindow>
  )
}
