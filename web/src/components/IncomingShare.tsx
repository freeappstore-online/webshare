import { useEffect, useState } from 'react'
import { FloatingWindow } from './FloatingWindow'
import { PeerAvatar } from './PeerAvatar'
import { canPickLocation, pickSaveTarget, type SaveTarget } from '../lib/saveTarget'
import type { IncomingRequest } from '../types'

interface IncomingShareProps {
  request: IncomingRequest | null
  onRespond: (request: IncomingRequest, accept: boolean, target?: SaveTarget | null) => void
  onDismiss: () => void
}

export function IncomingShare({ request, onRespond, onDismiss }: IncomingShareProps) {
  const withdrawn = request?.withdrawn ?? false
  // set while the folder/file picker is open — the window stays put behind it
  const [picking, setPicking] = useState(false)

  useEffect(() => { setPicking(false) }, [request?.reqId])

  /**
   * Accepting is also where we ask the browser for somewhere to write. The
   * picker needs the click's user activation, so it's called before any await.
   */
  const accept = (req: IncomingRequest) => {
    setPicking(true)
    const first = req.files[0]?.n ?? 'file'
    // a folder needs a directory to rebuild itself into, whatever the item count
    const hasFolder = req.files.some((f) => f.k === 'folder')
    void pickSaveTarget(req.total, first, hasFolder).then((target) => {
      setPicking(false)
      // picker dismissed — they changed their mind, leave the prompt up
      if (!target) return
      onRespond(req, true, target)
    })
  }

  return (
    <FloatingWindow
      open={!!request}
      closeOnBackdrop={!picking}
      onClose={withdrawn ? onDismiss : () => request && onRespond(request, false)}
    >
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
            <div className="flex w-full flex-col gap-2">
              <div className="flex w-full gap-3">
                <button
                  onClick={() => onRespond(request, false)}
                  disabled={picking}
                  className="min-h-12 flex-1 cursor-pointer rounded-full border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)] disabled:opacity-50"
                >
                  Decline
                </button>
                <button
                  onClick={() => accept(request)}
                  disabled={picking}
                  className="min-h-12 flex-1 cursor-pointer rounded-full bg-[var(--accent)] font-bold text-white disabled:opacity-60"
                >
                  {picking ? 'Choose a folder…' : 'Accept'}
                </button>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {canPickLocation
                  ? 'You’ll be asked where to save them'
                  : 'They’ll be saved to your downloads'}
              </p>
            </div>
          )}
        </div>
      )}
    </FloatingWindow>
  )
}
