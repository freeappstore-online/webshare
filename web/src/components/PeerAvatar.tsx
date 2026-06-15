import type { DeviceKind } from '../types'
import { DeviceIcon, PersonIcon } from './icons'

interface PeerAvatarProps {
  pfp: string | null
  /** Fallback when no pfp: their device icon. Pass null to fall back to the gray person icon instead. */
  device: DeviceKind | null
  name: string
  size?: number
  /** When set, CSS handles sizing (w-full h-full etc) instead of the size prop. */
  className?: string
}

/** Round avatar: profile picture if set, otherwise the user's device icon (or gray person). */
export function PeerAvatar({ pfp, device, name, size = 48, className }: PeerAvatarProps) {
  if (pfp) {
    return (
      <img
        src={pfp}
        alt={name}
        {...(className ? {} : { width: size, height: size })}
        className={`shrink-0 rounded-full object-cover${className ? ` ${className}` : ''}`}
        style={className ? undefined : { width: size, height: size }}
      />
    )
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--paper-deep)] text-[var(--muted)]${className ? ` ${className}` : ''}`}
      style={className ? { border: '1px solid var(--line)' } : { width: size, height: size, border: '1px solid var(--line)' }}
      title={name}
    >
      {className
        ? (device ? <DeviceIcon device={device} className="h-1/2 w-1/2" /> : <PersonIcon className="h-[55%] w-[55%]" />)
        : (device ? <DeviceIcon device={device} size={size * 0.5} /> : <PersonIcon size={size * 0.55} />)
      }
    </div>
  )
}
