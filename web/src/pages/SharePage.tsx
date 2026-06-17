import { EmptyState } from '@freeappstore/sdk/ui'
import { Dropdown } from '../components/Dropdown'
import { PeerAvatar } from '../components/PeerAvatar'
import { ViewIconsIcon, ViewListIcon } from '../components/icons'
import { DEVICE_LABEL } from '../lib/device'
import type { SignalState } from '../lib/signal'
import type { OutgoingRequest, PeerInfo, Profile } from '../types'

type ViewMode = 'icons' | 'list'
type ListIconSize = 'small' | 'medium' | 'big'
const LIST_ICON_PX: Record<ListIconSize, number> = { small: 22, medium: 44, big: 80 }
const VIEWS = [
  { key: 'icons' as const, label: 'Icons', Icon: ViewIconsIcon },
  { key: 'list' as const, label: 'List', Icon: ViewListIcon },
]


interface SharePageProps {
  profile: Profile
  fileCount: number
  view: ViewMode
  perRow: number
  listIconSize: ListIconSize
  onViewChange: (mode: ViewMode) => void
  onPerRowChange: (n: number) => void
  onListIconSizeChange: (s: ListIconSize) => void
  peers: PeerInfo[]
  connection: SignalState
  outgoing: OutgoingRequest[]
  onPick: (peer: PeerInfo) => void
  onBack: () => void
}

export function SharePage({
  profile,
  fileCount,
  view,
  perRow,
  listIconSize,
  onViewChange,
  onPerRowChange,
  onListIconSizeChange,
  peers,
  connection,
  outgoing,
  onPick,
  onBack,
}: SharePageProps) {
  // map toId → most recent outgoing request for that peer
  const outgoingByPeer: Record<string, OutgoingRequest> = {}
  for (const o of outgoing) outgoingByPeer[o.toId] = o

  return (
    <div className="mx-auto flex min-h-0 w-full flex-1 flex-col p-4">
      <div className="flex min-h-0 flex-1 flex-col min-[680px]:grid min-[680px]:grid-cols-[minmax(16rem,1fr)_minmax(0,42rem)_minmax(0,1fr)] min-[680px]:gap-0 -mb-6">

        {/* left column — profile */}
        <div className="mb-1 min-[680px]:mb-5 flex flex-col items-center gap-1.5 min-[680px]:gap-3 min-[680px]:sticky min-[680px]:top-6 min-[680px]:self-start">
          <span className="min-[680px]:hidden">
            <PeerAvatar pfp={profile.pfp} device={null} name={profile.name} size={100} />
          </span>
          <span className="hidden min-[680px]:inline">
            <PeerAvatar pfp={profile.pfp} device={null} name={profile.name} size={128} />
          </span>
          <p
            className="max-w-full truncate text-xl font-bold text-[var(--ink)]"
            style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em' }}
          >
            {profile.name}
          </p>
        </div>

        {/* middle column — recipient picker */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col w-full mx-auto">
          {/* mobile-only toolbar: instruction + view controls */}
          {fileCount > 0 && (
            <div className="min-[680px]:hidden flex h-11 shrink-0 items-center justify-between px-1">
              <p className="min-w-0 flex-1 truncate text-sm font-bold text-[var(--ink)]">
                {view === 'icons' ? (
                  <>
                    <span className="min-[320px]:hidden">Tap to send</span>
                    <span className="hidden min-[320px]:inline">Tap to send {fileCount} item{fileCount !== 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <>
                    <span className="min-[370px]:hidden">Tap to send</span>
                    <span className="hidden min-[370px]:inline">Tap to send {fileCount} item{fileCount !== 1 ? 's' : ''}</span>
                  </>
                )}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                {view === 'icons' && (
                  <Dropdown
                    value={perRow}
                    options={Array.from({ length: 8 }, (_, i) => ({ value: i + 1, label: `${i + 1} per row` }))}
                    onChange={onPerRowChange}
                    ariaLabel="Recipients per row"
                    trigger={<><span>{perRow}</span><span className="hidden min-[400px]:inline"> per row</span></>}
                  />
                )}
                {view === 'list' && (
                  <Dropdown
                    value={listIconSize}
                    options={[
                      { value: 'small' as const, label: 'Small icon' },
                      { value: 'medium' as const, label: 'Medium icon' },
                      { value: 'big' as const, label: 'Big icon' },
                    ]}
                    onChange={onListIconSizeChange}
                    ariaLabel="Avatar size"
                    trigger={<><span>{{ small: 'Small', medium: 'Medium', big: 'Big' }[listIconSize]}</span><span className="hidden min-[400px]:inline"> icon</span></>}
                  />
                )}
                <div className="relative flex shrink-0 rounded-full bg-[var(--page-pill-bg)] p-1">
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 top-1 w-11 rounded-full transition-transform duration-200 ease-out"
                    style={{
                      background: 'var(--page-pill-active)',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                      transform: `translateX(${VIEWS.findIndex((v) => v.key === view) * 100}%)`,
                    }}
                  />
                  {VIEWS.map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => onViewChange(key)}
                      aria-label={`${label} view`}
                      title={label}
                      className={`relative z-10 flex h-9 w-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 ${
                        view === key ? 'text-[var(--ink)]' : 'text-[var(--muted)]'
                      }`}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="ws-scroll min-h-0 flex-1 overflow-y-auto pb-6 mb-[6px]">

          {connection === 'open' && peers.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <EmptyState
                title="No one's here yet"
                message="Ask the other person to open Webshare on the same Wi-Fi and switch discoverable on — they'll show up here. No sign-up needed."
              />
            </div>
          )}

          {view === 'list' && (
            <ul className="mt-2">
              {peers.map((peer) => {
                const req = outgoingByPeer[peer.id]
                const isPulsing = req?.status === 'waiting'
                return (
                  <li
                    key={peer.id}
                    className="relative [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:content-[''] [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[var(--sep-left)] [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-[var(--line-strong)]"
                    style={{ '--sep-left': `${4 + LIST_ICON_PX[listIconSize] + 12}px` } as React.CSSProperties}
                  >
                    <button
                      onClick={() => onPick(peer)}
                      className="flex w-full cursor-pointer items-center gap-3 px-1 py-2.5"
                    >
                      <span className={`shrink-0 ${isPulsing ? 'animate-avatar-pulse' : ''}`}>
                        <PeerAvatar pfp={peer.pfp} device={peer.device} name={peer.name} size={LIST_ICON_PX[listIconSize]} />
                      </span>
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-semibold text-[var(--ink)]">{peer.name}</p>
                        <p className={`text-xs ${req ? (req.status === 'accepted' ? 'text-[var(--success)]' : req.status === 'declined' ? 'text-[var(--error)]' : 'text-[var(--muted)]') : 'text-[var(--muted)]'}`}>
                          {req ? (req.status === 'waiting' ? 'Waiting…' : req.status === 'accepted' ? 'Sent' : 'Declined') : DEVICE_LABEL[peer.device]}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {view === 'icons' && (
            <ul
              className="mt-2 grid gap-3"
              style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
            >
              {peers.map((peer) => {
                const req = outgoingByPeer[peer.id]
                const isPulsing = req?.status === 'waiting'
                return (
                  <li key={peer.id}>
                    <button
                      onClick={() => onPick(peer)}
                      className="flex w-full cursor-pointer flex-col items-center gap-1 rounded-[var(--radius-sm)] p-2"
                    >
                      <span
                        className={`block aspect-square w-full overflow-hidden rounded-full ${isPulsing ? 'animate-avatar-pulse' : ''}`}
                      >
                        <PeerAvatar pfp={peer.pfp} device={peer.device} name={peer.name} className="h-full w-full" />
                      </span>
                      <div className="flex w-full flex-col items-center">
                        <span className="w-full truncate px-1 text-center text-xs font-semibold text-[var(--ink)]">
                          {peer.name}
                        </span>
                        {req && (
                          <span className={`text-xs leading-tight ${req.status === 'accepted' ? 'text-[var(--success)]' : req.status === 'declined' ? 'text-[var(--error)]' : 'text-[var(--muted)]'}`}>
                            {req.status === 'waiting' ? 'Waiting…' : req.status === 'accepted' ? 'Sent' : 'Declined'}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          </div>{/* end scroll container */}
        </div>

        {/* right spacer (desktop only) */}
        <div className="hidden min-[680px]:block" />
      </div>

      {/* sticky bottom */}
      <div className="sticky bottom-0 -mx-4 px-4 min-[680px]:grid min-[680px]:grid-cols-[minmax(16rem,1fr)_minmax(0,42rem)_minmax(0,1fr)] min-[680px]:gap-0">
        <div className="hidden min-[680px]:block" />
        <div className="mx-auto w-full max-w-2xl">
          <p className="relative z-10 mb-0.5 text-center text-xs text-[var(--muted)]">
            Not here? Check if they are on your Wi-Fi and discoverable
          </p>
          <div className="relative">
            <div className="pointer-events-none absolute bottom-full left-0 right-0 h-4" style={{ background: 'linear-gradient(to bottom, transparent, var(--bg-end))' }} />
            <div className="relative z-10 rounded-full bg-[var(--bg-end)]">
              <button
                onClick={onBack}
                className="flex w-full cursor-pointer items-center justify-center rounded-full border border-[var(--secondary-btn-border)] bg-[var(--secondary-btn-bg)] py-2 font-bold text-[var(--secondary-btn-text)]"
              >
                Back to items
              </button>
            </div>
          </div>
        </div>
        <div className="hidden min-[680px]:block" />
      </div>
    </div>
  )
}
