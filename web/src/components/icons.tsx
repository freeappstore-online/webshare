import type { DeviceKind, FileKind } from '../types'

interface IconProps {
  size?: number
  className?: string
}

function Svg({ size = 20, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Default profile icon when a user hasn't set a picture (onboarding preview). */
export function PersonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </Svg>
  )
}

export function DeviceIcon({ device, ...props }: IconProps & { device: DeviceKind | null }) {
  switch (device) {
    case 'phone':
      return (
        <Svg {...props}>
          <rect x="7" y="2" width="10" height="20" rx="2.5" />
          <line x1="11" y1="18.5" x2="13" y2="18.5" />
        </Svg>
      )
    case 'tablet':
      return (
        <Svg {...props}>
          <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
          <line x1="11" y1="18.5" x2="13" y2="18.5" />
        </Svg>
      )
    case 'laptop':
      return (
        <Svg {...props}>
          <rect x="4" y="5" width="16" height="11" rx="1.5" />
          <path d="M2 19h20" />
        </Svg>
      )
    case 'watch':
      return (
        <Svg {...props}>
          <rect x="7.5" y="7" width="9" height="10" rx="2.5" />
          <path d="M9.5 7V3.5h5V7M9.5 17v3.5h5V17" />
        </Svg>
      )
    case 'desktop':
    default:
      return (
        <Svg {...props}>
          <rect x="3" y="4" width="18" height="12" rx="1.5" />
          <path d="M9 20h6M12 16v4" />
        </Svg>
      )
  }
}

export function FileKindIcon({ kind, ...props }: IconProps & { kind: FileKind }) {
  switch (kind) {
    case 'image':
      return (
        <Svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M21 16.5 16 11l-8 9" />
        </Svg>
      )
    case 'video':
      return (
        <Svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m10 9.5 5 2.5-5 2.5z" />
        </Svg>
      )
    case 'audio':
      return (
        <Svg {...props}>
          <path d="M9 18V6l11-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="17.5" cy="16" r="2.5" />
        </Svg>
      )
    case 'archive':
      return (
        <Svg {...props}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M12 3v3m0 2v2m0 2v2" />
        </Svg>
      )
    case 'doc':
      return (
        <Svg {...props}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </Svg>
      )
    default:
      return (
        <Svg {...props}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </Svg>
      )
  }
}

/** Top-left wordmark: fluffy all-curves cloud (mint→sky gradient outline) + "Webshare". */
export function WebshareLogo() {
  return (
    <div className="flex items-center gap-1">
      <Svg size={38}>
        <defs>
          <linearGradient id="cloud-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            {/* light green tip top-left fading into dark green */}
            <stop offset="0%" stopColor="#e3fcec" />
            <stop offset="26%" stopColor="#44a06c" />
            <stop offset="100%" stopColor="#2a7a4c" />
          </linearGradient>
        </defs>
        <path
          d="M4.5 16.8 C2.6 16.4 1.9 13.9 3.4 12.6 C2.9 10.4 5 8.6 7.1 9.2 C7.7 6.6 11 5.4 13 7.1 C14.8 5.6 17.7 6.6 18.1 8.9 C20.3 9 21.7 11 21 13 C22.4 14.6 21.3 16.7 19.3 16.9 C17.9 18.6 15.6 18.4 14.2 17.4 C12.8 18.7 10.6 18.7 9.2 17.5 C7.7 18.5 5.6 18.2 4.5 16.8 Z"
          stroke="url(#cloud-gradient)"
        />
      </Svg>
      <span className="display-font text-lg font-bold text-[var(--ink)]">Webshare</span>
    </div>
  )
}

export function InfoCircleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </Svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  )
}

export function EditIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </Svg>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 16V4m0 0 -4.5 4.5M12 4l4.5 4.5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Svg>
  )
}
