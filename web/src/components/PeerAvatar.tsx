import type { DeviceKind } from '../types'
import { DeviceIcon, PersonIcon } from './icons'

interface PeerAvatarProps {
  pfp: string | null
  /** Fallback when no pfp: their device icon. Pass null to fall back to the gray person icon instead. */
  device: DeviceKind | null
  name: string
  size?: number
}

/** Round avatar: profile picture if set, otherwise the user's device icon (or gray person). */
export function PeerAvatar({ pfp, device, name, size = 48 }: PeerAvatarProps) {
  if (pfp) {
    return (
      <img
        src={pfp}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--paper-deep)] text-[var(--muted)]"
      style={{ width: size, height: size, border: '1px solid var(--line)' }}
      title={name}
    >
      {device ? <DeviceIcon device={device} size={size * 0.5} /> : <PersonIcon size={size * 0.55} />}
    </div>
  )
}
