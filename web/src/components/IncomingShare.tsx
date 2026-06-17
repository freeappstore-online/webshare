import { FloatingWindow } from './FloatingWindow'
import { PeerAvatar } from './PeerAvatar'
import type { IncomingRequest } from '../types'

interface IncomingShareProps {
  request: IncomingRequest | null
  onRespond: (request: IncomingRequest, accept: boolean) => void
}

export function IncomingShare({ request, onRespond }: IncomingShareProps) {
  return (
    <FloatingWindow open={!!request} onClose={() => request && onRespond(request, false)}>
      {request && (
        <div className="flex flex-col items-center gap-4 text-center">
          <PeerAvatar pfp={request.from.pfp} device={request.from.device} name={request.from.name} size={64} />
          <p className="text-base font-semibold text-[var(--ink)]">
            <span className="font-bold">{request.from.name}</span> would like to share{' '}
            {request.total} item{request.total === 1 ? '' : 's'} with you
          </p>
          <div className="flex w-full gap-3">
            <button
              onClick={() => onRespond(request, false)}
              className="min-h-12 flex-1 cursor-pointer rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
            >
              Decline
            </button>
            <button
              onClick={() => onRespond(request, true)}
              className="min-h-12 flex-1 cursor-pointer rounded-[var(--radius)] bg-[var(--accent)] font-bold text-white"
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </FloatingWindow>
  )
}
