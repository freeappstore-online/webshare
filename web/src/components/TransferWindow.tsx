import { useEffect, useRef, useState } from 'react'
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

/** Throughput over the last few seconds, in bytes/sec. */
const RATE_WINDOW_MS = 3000

/**
 * Live transfer speed.
 *
 * Deliberately *not* bytes ÷ time-since-the-transfer-started: that start is
 * stamped before the WebRTC handshake, so connection setup gets averaged into
 * the number and a quick transfer of a small file reads as a few hundred KB/s
 * however fast the link really is. Sampling a short trailing window measures
 * what is actually flowing right now.
 */
function useTransferRate(bytesDone: number, running: boolean, reqId: string | undefined) {
  const samples = useRef<{ t: number; b: number }[]>([])
  const latest = useRef(bytesDone)
  latest.current = bytesDone
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    samples.current = []
    setText(null)
  }, [reqId])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const now = Date.now()
      samples.current.push({ t: now, b: latest.current })
      const cutoff = now - RATE_WINDOW_MS
      while (samples.current.length > 2 && samples.current[0].t < cutoff) samples.current.shift()

      const first = samples.current[0]
      const last = samples.current[samples.current.length - 1]
      const secs = (last.t - first.t) / 1000
      const moved = last.b - first.b
      // nothing has moved yet (still connecting) — say nothing rather than "0 B/s"
      setText(secs >= 0.5 && moved > 0 ? `${formatBytes(moved / secs)}/s` : null)
    }, 400)
    return () => clearInterval(id)
  }, [running, reqId])

  return text
}

export function TransferWindow({ transfer, onCancel, onDismiss }: TransferWindowProps) {
  const running = transfer?.state === 'connecting' || transfer?.state === 'transferring'
  const speed = useTransferRate(transfer?.bytesDone ?? 0, running, transfer?.reqId)
  const [copied, setCopied] = useState(false)
  const [showReport, setShowReport] = useState(false)
  useEffect(() => { setCopied(false); setShowReport(false) }, [transfer?.reqId])

  // FloatingWindow keeps the last children on screen for the exit animation,
  // so the null case still has to render the window itself
  if (!transfer) return <FloatingWindow open={false} onClose={() => {}}>{null}</FloatingWindow>

  const { reqId, dir, state, bytesDone, bytesTotal, filesDone, filesTotal } = transfer
  const pct = bytesTotal > 0 ? Math.min(100, (bytesDone / bytesTotal) * 100) : state === 'done' ? 100 : 0
  const done = state === 'done'
  const failed = state === 'error' || state === 'cancelled'
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
                    ? 'Connecting directly…'
                    : ''}
            {speed && ` · ${speed}`}
          </p>

        </div>

        {/* a phone has no console, so the report has to be reachable here */}
        {!running && transfer.report && (
          <div className="w-full">
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(transfer.report!).then(
                    () => setCopied(true),
                    () => setShowReport(true),
                  )
                }}
                className="cursor-pointer text-xs font-semibold text-[var(--muted)] underline"
              >
                {copied ? 'Copied ✓' : 'Copy speed report'}
              </button>
              <button
                onClick={() => setShowReport((v) => !v)}
                className="cursor-pointer text-xs font-semibold text-[var(--muted)] underline"
              >
                {showReport ? 'Hide' : 'Show'}
              </button>
            </div>
            {showReport && (
              <pre
                className="ws-scroll mt-2 max-h-56 w-full overflow-auto rounded-[var(--radius-sm)] p-2 text-left text-[10px] leading-tight text-[var(--ink)]"
                style={{ background: 'var(--paper-deep)', border: '1px solid var(--line-strong)' }}
              >
                {transfer.report}
              </pre>
            )}
          </div>
        )}

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
