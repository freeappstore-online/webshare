import { useEffect, useState } from 'react'
import { FloatingWindow } from './FloatingWindow'
import { PeerAvatar } from './PeerAvatar'
import { CheckIcon, TriangleInfoIcon } from './icons'
import { formatBytes } from '../lib/files'
import type { TransferProgress } from '../types'

interface TransferWindowProps {
  transfer: TransferProgress | null
  onCancel: (reqId: string) => void
  onDismiss: (reqId: string) => void
}

/** "1.2 MB/s" from bytes moved since the transfer started. */
function rate(bytes: number, since: number): string | null {
  const secs = (Date.now() - since) / 1000
  if (secs < 1 || bytes <= 0) return null
  return `${formatBytes(bytes / secs)}/s`
}

export function TransferWindow({ transfer, onCancel, onDismiss }: TransferWindowProps) {
  // repaint the speed/ETA line even between progress events
  const [, tick] = useState(0)
  const running = transfer?.state === 'connecting' || transfer?.state === 'transferring'
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [running])

  // FloatingWindow keeps the last children on screen for the exit animation,
  // so the null case still has to render the window itself
  if (!transfer) return <FloatingWindow open={false} onClose={() => {}}>{null}</FloatingWindow>

  const { reqId, dir, state, bytesDone, bytesTotal, filesDone, filesTotal } = transfer
  const pct = bytesTotal > 0 ? Math.min(100, (bytesDone / bytesTotal) * 100) : state === 'done' ? 100 : 0
  const done = state === 'done'
  const failed = state === 'error' || state === 'cancelled'
  const speed = running ? rate(bytesDone, transfer.startedAt) : null
  const verb = dir === 'send' ? 'Sending' : 'Receiving'

  const heading = done
    ? dir === 'send' ? 'Sent' : 'Saved'
    : state === 'cancelled'
      ? 'Transfer cancelled'
      : state === 'error'
        ? "Transfer didn't finish"
        : state === 'connecting'
          ? 'Connecting…'
          : `${verb} ${filesTotal} item${filesTotal === 1 ? '' : 's'}`

  return (
    <FloatingWindow open onClose={() => (running ? onCancel(reqId) : onDismiss(reqId))}>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <PeerAvatar pfp={transfer.peerPfp} device={null} name={transfer.peerName} size={72} />
          <p
            className="text-xl font-bold text-[var(--ink)]"
            style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em' }}
          >
            {transfer.peerName}
          </p>
          <p className={`flex items-center gap-1.5 text-sm ${done ? 'text-[var(--success)]' : failed ? 'text-[var(--error)]' : 'text-[var(--muted)]'}`}>
            {done && <CheckIcon size={15} />}
            {failed && <TriangleInfoIcon size={16} />}
            {heading}
          </p>
        </div>

        <div className="w-full">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--line-strong)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${failed ? 100 : pct}%`,
                // --accent, not --accent-gradient: the latter is a faint tint
                // for drop-zone backgrounds and reads as almost empty here
                background: failed ? 'var(--error)' : done ? 'var(--success)' : 'var(--accent)',
                // no easing on the first paint, then smooth out the jumps
                transition: 'width 200ms linear',
              }}
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs text-[var(--muted)]">
            <span className="tabular-nums">
              {bytesTotal > 0 ? `${formatBytes(bytesDone)} of ${formatBytes(bytesTotal)}` : '—'}
            </span>
            <span className="tabular-nums">
              {failed ? '' : done ? '100%' : `${Math.floor(pct)}%`}
            </span>
          </div>

          <p className="mt-1 min-h-4 truncate text-xs text-[var(--muted)]">
            {failed
              ? transfer.error
              : done
                ? dir === 'recv' && transfer.savedTo
                  ? `${filesTotal} item${filesTotal === 1 ? '' : 's'} saved to ${transfer.savedTo}`
                  : `${filesTotal} item${filesTotal === 1 ? '' : 's'} delivered`
                : transfer.currentName
                  ? `${filesDone + 1} of ${filesTotal} · ${transfer.currentName}`
                  : state === 'connecting'
                    ? 'Setting up a direct connection…'
                    : ''}
            {speed && ` · ${speed}`}
          </p>

          {transfer.relayed && running && (
            <p className="mt-1 text-xs text-[var(--warning)]">
              No direct route — relaying, this will be slower
            </p>
          )}
        </div>

        {running ? (
          <button
            onClick={() => onCancel(reqId)}
            className="min-h-12 w-full cursor-pointer rounded-full border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => onDismiss(reqId)}
            className={`min-h-12 w-full cursor-pointer rounded-full font-bold ${
              done
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--line-strong)] bg-[var(--panel)] text-[var(--ink)]'
            }`}
          >
            {done ? 'Done' : 'Close'}
          </button>
        )}
      </div>
    </FloatingWindow>
  )
}
