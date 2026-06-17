import { FloatingWindow } from './FloatingWindow'
import { PeerAvatar } from './PeerAvatar'
import type { IncomingRequest } from '../types'

interface IncomingShareProps {
  request: IncomingRequest | null
  onRespond: (request: IncomingRequest, accept: boolean) => void
  onDismiss: () => void
}

export function IncomingShare({ request, onRespond, onDismiss }: IncomingShareProps) {
  const withdrawn = request?.withdrawn ?? false
  return (
    <FloatingWindow open={!!request} closeOnBackdrop onClose={withdrawn ? onDismiss : () => request && onRespond(request, false)}>
      {request && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <PeerAvatar pfp={request.from.pfp} device={null} name={request.from.name} size={80} />
            <p className="text-xl font-bold text-[var(--ink)]" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em' }}>
              {request.from.name}
            </p>
            <p className="text-sm text-[var(--muted)]">
              {withdrawn ? 'withdrew sharing' : `would like to share ${request.total} item${request.total === 1 ? '' : 's'}`}
            </p>
          </div>
          {withdrawn ? (
            <button
              onClick={onDismiss}
              className="min-h-12 w-full cursor-pointer rounded-full border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
            >
              OK
            </button>
          ) : (
            <div className="flex w-full gap-3">
              <button
                onClick={() => onRespond(request, false)}
                className="min-h-12 flex-1 cursor-pointer rounded-full border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
              >
                Decline
              </button>
              <button
                onClick={() => onRespond(request, true)}
                className="min-h-12 flex-1 cursor-pointer rounded-full bg-[var(--accent)] font-bold text-white"
              >
                Accept
              </button>
            </div>
          )}
        </div>
      )}
    </FloatingWindow>
  )
}
