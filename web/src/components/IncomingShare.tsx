import { Modal } from '@freeappstore/sdk/ui'
import { formatBytes } from '../lib/files'
import { FileKindIcon } from './icons'
import { PeerAvatar } from './PeerAvatar'
import type { IncomingRequest } from '../types'

interface IncomingShareProps {
  request: IncomingRequest | null
  onRespond: (request: IncomingRequest, accept: boolean) => void
}

/** Pops on the recipient's screen: "<name> wants to share N files" with a grid preview. */
export function IncomingShare({ request, onRespond }: IncomingShareProps) {
  if (!request) return null
  const more = request.total - request.files.length

  return (
    <Modal open onClose={() => onRespond(request, false)} maxWidth={440}>
      <div className="flex flex-col items-center text-center">
        <PeerAvatar pfp={request.from.pfp} device={request.from.device} name={request.from.name} size={56} />
        <p className="mt-3 text-base font-bold text-[var(--ink)]">
          {request.from.name} wants to share {request.total} file{request.total === 1 ? '' : 's'} with you
        </p>
      </div>

      <div className="mt-4 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
        {request.files.map((f, i) => (
          <div
            key={`${f.n}:${i}`}
            className="flex flex-col items-center gap-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--paper-deep)] p-2"
            title={f.n}
          >
            <span className="text-[var(--accent)]">
              <FileKindIcon kind={f.k} size={22} />
            </span>
            <span className="w-full truncate text-center text-[0.65rem] font-semibold text-[var(--ink)]">
              {f.n}
            </span>
            <span className="text-[0.6rem] text-[var(--muted)]">{formatBytes(f.s)}</span>
          </div>
        ))}
        {more > 0 && (
          <div className="flex items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] p-2 text-xs font-semibold text-[var(--muted)]">
            +{more} more
          </div>
        )}
      </div>

      <div className="mt-5 flex gap-3">
        <button
          onClick={() => onRespond(request, false)}
          className="min-h-12 flex-1 rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
        >
          Decline
        </button>
        <button
          onClick={() => onRespond(request, true)}
          className="min-h-12 flex-1 rounded-[var(--radius)] bg-[var(--accent)] font-bold text-white"
        >
          Accept
        </button>
      </div>
    </Modal>
  )
}
