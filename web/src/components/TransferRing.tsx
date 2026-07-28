import type { ReactNode } from 'react'
import type { TransferProgress } from '../types'

/** Drawn in a 100×100 viewBox so one component scales to any avatar size. */
const R = 45
const CIRC = 2 * Math.PI * R

function ringColor(state: TransferProgress['state']): string {
  if (state === 'done') return 'var(--success)'
  if (state === 'error' || state === 'cancelled') return 'var(--error)'
  return 'var(--accent)'
}

/**
 * AirDrop-style send indicator: the recipient's avatar eases down a little and
 * a progress ring closes around it, instead of a modal taking over the screen.
 * The sender already knows what they sent and to whom — the only new
 * information is how far along it is, so it belongs on the recipient.
 *
 * The wrapper renders whether or not a transfer is running, so the avatar
 * animates into and out of the ring rather than snapping.
 */
export function TransferRing({
  transfer,
  children,
}: {
  transfer: TransferProgress | null
  children: ReactNode
}) {
  const state = transfer?.state
  const pct =
    transfer && transfer.bytesTotal > 0
      ? Math.min(100, (transfer.bytesDone / transfer.bytesTotal) * 100)
      : 0
  // a finished ring reads as a closed circle whatever the byte count did;
  // a failed one is left showing how far it actually got
  const shown = state === 'done' ? 100 : state === 'connecting' ? 0 : pct

  return (
    <span className="relative block h-full w-full">
      <span
        className="block h-full w-full transition-transform duration-300 ease-out"
        style={{ transform: transfer ? 'scale(0.82)' : 'scale(1)' }}
      >
        {children}
      </span>
      {transfer && (
        <svg
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
        >
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="5" />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={ringColor(state!)}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - shown / 100)}
            style={{ transition: 'stroke-dashoffset 200ms linear, stroke 250ms ease-out' }}
          />
          {/* nothing to report yet — sweep an arc so it reads as busy, not stalled */}
          {state === 'connecting' && (
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={ringColor(state)}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${CIRC * 0.16} ${CIRC}`}
              className="animate-spin"
              style={{ transformOrigin: 'center', animationDuration: '1.1s' }}
            />
          )}
        </svg>
      )}
    </span>
  )
}

/** The line under the name while a transfer to this peer is under way. */
export function transferLabel(t: TransferProgress): string {
  if (t.state === 'done') return 'Sent'
  if (t.state === 'cancelled') return 'Cancelled'
  if (t.state === 'error') return t.error ?? 'Failed'
  if (t.state === 'connecting') return 'Connecting…'
  const pct = t.bytesTotal > 0 ? Math.floor((t.bytesDone / t.bytesTotal) * 100) : 0
  return t.relayed ? `Relaying ${pct}%` : `Sending ${pct}%`
}

export function transferColor(t: TransferProgress): string {
  if (t.state === 'done') return 'text-[var(--success)]'
  if (t.state === 'error' || t.state === 'cancelled') return 'text-[var(--error)]'
  return 'text-[var(--muted)]'
}
