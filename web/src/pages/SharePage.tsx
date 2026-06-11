import { EmptyState, Spinner } from '@freeappstore/sdk/ui'
import { PeerAvatar } from '../components/PeerAvatar'
import { DEVICE_LABEL } from '../lib/device'
import type { SignalState } from '../lib/signal'
import type { OutgoingRequest, PeerInfo } from '../types'

interface SharePageProps {
  fileCount: number
  peers: PeerInfo[]
  connection: SignalState
  outgoing: OutgoingRequest | null
  onPick: (peer: PeerInfo) => void
  onClearOutgoing: () => void
  onBack: () => void
}

/** Recipient picker: everyone on your network with webshare open right now. */
export function SharePage({
  fileCount,
  peers,
  connection,
  outgoing,
  onPick,
  onClearOutgoing,
  onBack,
}: SharePageProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label="Back to files"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]"
        >
          ←
        </button>
        <div>
          <h1 className="display-font text-lg font-bold text-[var(--ink)]">Send to</h1>
          <p className="text-xs text-[var(--muted)]">
            Sharing {fileCount} file{fileCount === 1 ? '' : 's'} · people on your network
          </p>
        </div>
      </div>

      {connection !== 'open' && (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
          <Spinner size={18} />
          Connecting…
        </div>
      )}

      {connection === 'open' && peers.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="No one's here yet"
            message="Ask the other person to open webshare on the same Wi-Fi — they'll show up here. No sign-up needed."
          />
        </div>
      )}

      <ul className="mt-4 flex min-h-0 flex-1 flex-wrap content-center items-start justify-center gap-x-6 gap-y-8 overflow-y-auto">
        {peers.map((peer) => (
          <li key={peer.id}>
            <button
              onClick={() => onPick(peer)}
              disabled={outgoing?.status === 'waiting'}
              className="flex w-24 flex-col items-center gap-2 disabled:opacity-50"
            >
              <span className="relative">
                <PeerAvatar pfp={peer.pfp} device={peer.device} name={peer.name} size={64} />
                <span
                  className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-[var(--success)]"
                  style={{ border: '2px solid var(--paper)' }}
                  aria-label="online"
                />
              </span>
              <span className="w-full truncate text-center text-sm font-semibold text-[var(--ink)]">
                {peer.name}
              </span>
              <span className="-mt-1.5 text-xs text-[var(--muted)]">{DEVICE_LABEL[peer.device]}</span>
            </button>
          </li>
        ))}
      </ul>

      {outgoing && (
        <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-[var(--paper)] via-[var(--paper)] to-transparent px-4 pb-4 pt-6">
          <div className="flex items-center gap-3 rounded-[1.25rem] border border-[var(--line)] bg-[var(--panel-strong)] p-4 shadow-[var(--shadow-card)]">
            {outgoing.status === 'waiting' && (
              <>
                <Spinner size={20} />
                <p className="flex-1 text-sm text-[var(--ink)]">
                  Waiting for <strong>{outgoing.toName}</strong> to accept…
                </p>
                <button onClick={onClearOutgoing} className="text-sm font-semibold text-[var(--muted)]">
                  Cancel
                </button>
              </>
            )}
            {outgoing.status === 'accepted' && (
              <>
                <p className="flex-1 text-sm text-[var(--success)]">
                  <strong>{outgoing.toName}</strong> accepted! Transfer coming in the next update.
                </p>
                <button onClick={onClearOutgoing} className="text-sm font-semibold text-[var(--accent)]">
                  OK
                </button>
              </>
            )}
            {outgoing.status === 'declined' && (
              <>
                <p className="flex-1 text-sm text-[var(--error)]">
                  <strong>{outgoing.toName}</strong> declined the request.
                </p>
                <button onClick={onClearOutgoing} className="text-sm font-semibold text-[var(--accent)]">
                  OK
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
