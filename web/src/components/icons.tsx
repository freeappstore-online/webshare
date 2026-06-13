import { useId } from 'react'
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

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 12.5l4.5 5L18.5 5" strokeWidth={3} />
    </Svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" strokeWidth={3} />
    </Svg>
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

/**
 * macOS-style blank doc: solid white A4 page (1:1.414) with a folded top-right
 * corner. Children render on the page (clipped to it) and the fold flap is
 * drawn last so it always covers them — pass text etc. as children.
 */
/** Lines for text printed straight on the paper: the file's own line breaks
    are kept; the first rows stay narrow so they clear the folded corner. */
function previewLines(text: string, max = 11): string[] {
  const widthAt = (row: number) => (row < 3 ? 10 : 18)
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (!line) {
      out.push('')
      if (out.length >= max) return out
      continue
    }
    let rest = line
    while (rest) {
      const w = widthAt(out.length)
      out.push(rest.slice(0, w))
      rest = rest.slice(w)
      if (out.length >= max) return out
    }
  }
  return out
}

export function PaperIcon({
  size = 20,
  className,
  label,
  preview,
  previewText,
  aspect,
  children,
}: IconProps & {
  label?: string
  preview?: string
  previewText?: string
  /** content width/height ratio — the paper adapts (landscape pages go wide);
      default is A4 portrait. The top-right fold is the invariant. */
  aspect?: number
  children?: React.ReactNode
}) {
  const clipId = useId()
  // page geometry: longest side fixed at 19.8 units, shape follows content
  const ratio = Math.min(2.2, Math.max(0.45, aspect ?? 14 / 19.8))
  const W = ratio >= 1 ? 19.8 : 19.8 * ratio
  const H = ratio >= 1 ? 19.8 / ratio : 19.8
  const left = 5
  const top = 3
  const right = left + W
  const bottom = top + H
  const fold = 5.5
  const page = `M${right - fold} ${top}H${left + 1}a1 1 0 0 0-1 1v${H - 2}a1 1 0 0 0 1 1h${
    W - 2
  }a1 1 0 0 0 1-1V${top + fold}z`
  return (
    <svg
      width={size}
      height={size}
      // cropped to the artwork so the paper fills its box edge-to-edge
      viewBox={`${left - 0.5} ${top - 0.5} ${W + 1} ${H + 1}`}
      className={className}
      style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.35))' }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={page} />
        </clipPath>
      </defs>
      <path d={page} fill="#ffffff" />
      {(children || label || preview || previewText) && (
        <g clipPath={`url(#${clipId})`}>
          {children}
          {previewText &&
            previewLines(previewText).map((line, i) =>
              line ? (
                <text
                  key={i}
                  x={left + 1.3}
                  y={top + 1.9 + i * 1.45}
                  fontSize="1.1"
                  fill="#8a8a8a"
                  fontFamily="ui-monospace, Menlo, monospace"
                  xmlSpace="preserve"
                >
                  {line}
                </text>
              ) : null,
            )}
          {preview && (
            // rendered page snapshot (same ratio as the paper) on the page;
            // the fold flap is drawn above it
            <image
              href={preview}
              x={left}
              y={top}
              width={W}
              height={H}
              preserveAspectRatio="xMidYMin slice"
            />
          )}
          {label && (
            <text
              x={(left + right) / 2}
              y={bottom - 1.2}
              textAnchor="middle"
              fontSize="3.4"
              fontWeight="700"
              fill="#8e8e8e"
              fontFamily="inherit"
              letterSpacing="0.1"
            >
              {label}
            </text>
          )}
        </g>
      )}
      {/* the fold's geometry is fixed; it just rides on the top-right corner */}
      <g transform={`translate(${right - 19} ${top - 3})`}>
        <PaperFoldCorner />
      </g>
    </svg>
  )
}

/** The page's folded top-right corner; render last so it covers page content. */
export function PaperFoldCorner() {
  return (
    <>
      <defs>
        <filter id="ws-fold-shadow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="0.28" />
        </filter>
      </defs>
      {/* soft blurred shadow, widest at the fold tip and tapering toward both
          hinge ends; tip vertex rounded like the fold's own corner */}
      <path
        d="M13.5 3Q13.2 6.4 13.08 8.15Q13.05 8.95 13.75 8.92Q16.8 9.1 19 8.5L16.4 6.7z"
        fill="rgba(0, 0, 0, 0.26)"
        filter="url(#ws-fold-shadow)"
      />
      {/* the white fold flap */}
      <path d="M13.5 3v4.5a1 1 0 0 0 1 1H19z" fill="#ffffff" />
    </>
  )
}

/** Square gray tile with a white music note — audio files without embedded art. */
export function AudioSquareIcon({ size = 20, className, art }: IconProps & { art?: string }) {
  const artClipId = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.35))' }}
      aria-hidden="true"
    >
      {/* rx 0.5 viewBox units ≈ the 3px corner the image previews use */}
      <rect x="2" y="2" width="20" height="20" rx="0.5" fill="#f2f2f2" />
      {/* album art fills the square; the note floats over it half-transparent */}
      {art && (
        <>
          <defs>
            <clipPath id={artClipId}>
              <rect x="2" y="2" width="20" height="20" rx="0.5" />
            </clipPath>
          </defs>
          <image
            href={art}
            x="2"
            y="2"
            width="20"
            height="20"
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${artClipId})`}
          />
        </>
      )}
      {/* viewBox cropped to the path's bbox so the note centers in the square */}
      <svg x="6.2" y="7.4" width="10" height="10" viewBox="22 25 393.5 484" opacity={art ? 0.5 : 1}>
        <path
          fill="#cccccc"
          d="m371.5 28.08c-7.7 1.59-20.3 4.24-28 5.91-7.7 1.66-17.6 3.66-22 4.45-4.4 0.78-15.2 3.04-24 5.02-8.8 1.98-20.73 4.46-26.5 5.52-5.77 1.05-18.15 3.53-27.5 5.51-9.35 1.98-26.45 5.58-38 8-11.55 2.42-27.07 5.57-34.5 7-7.43 1.44-15.75 3.68-18.5 4.99-2.75 1.31-6.31 3.43-7.92 4.7-1.6 1.28-3.79 4.35-4.86 6.82-1.89 4.39-1.93 7.7-1.58 140.57l0.36 136.07c-4.26 6.48-6.96 9-8.75 9.78-1.79 0.78-12.25 3.25-23.25 5.48-11 2.23-24.95 5.55-31 7.37-6.05 1.81-14.83 5.37-19.5 7.89q-8.5 4.59-16.06 11.97c-5.17 5.04-8.69 9.58-11.16 14.37-2.27 4.39-4.21 10.17-5.21 15.5-0.88 4.68-1.6 10.98-1.6 14 0 3.02 0.72 9.33 1.59 14 1.06 5.72 2.76 10.63 5.19 15 1.99 3.58 6.12 9.02 9.18 12.09 3.06 3.08 8.04 7.19 11.07 9.13 3.03 1.94 9.33 4.77 14 6.3 6.74 2.19 10.99 2.86 20.5 3.23 9.89 0.38 13.54 0.09 20.75-1.65 4.81-1.15 11.79-3.47 15.5-5.15 3.71-1.68 9-4.48 11.75-6.21 2.75-1.73 7.43-5.2 10.4-7.7 2.97-2.5 7.25-6.96 9.5-9.92 2.26-2.96 5.11-6.89 6.35-8.75 1.24-1.85 3.79-7.08 5.66-11.62 1.88-4.54 4.21-11.62 5.18-15.75 1.63-6.9 1.79-16.88 2.08-125 0.18-64.62 0.53-118.85 0.78-120.5 0.26-1.74 1.52-3.74 3-4.75 1.4-0.96 8.29-3.04 15.3-4.63 7.01-1.58 14.78-3.17 17.25-3.54 2.47-0.37 13.73-2.64 25-5.05 11.27-2.41 30.62-6.47 43-9.03 12.37-2.55 23.85-4.85 25.5-5.11 1.65-0.27 12.23-2.47 23.5-4.89 11.27-2.42 27.7-5.81 36.5-7.53 12.77-2.5 16.56-2.91 18.75-2.05 1.51 0.59 3.16 2.09 3.67 3.33 0.5 1.24 1.4 36.23 1.99 77.75 0.93 65.12 0.88 76.19-0.36 80.5-0.8 2.75-2.48 5.96-3.75 7.13-1.26 1.18-3.87 2.92-5.8 3.89-1.93 0.96-10.02 3.06-18 4.66-7.98 1.6-18.77 4-24 5.33-5.23 1.33-13.32 3.71-18 5.29-4.68 1.58-10.75 4.16-13.5 5.74-2.75 1.58-7.25 4.42-10 6.32-2.75 1.89-7.02 5.55-9.5 8.13-2.48 2.58-6.16 7.8-8.19 11.6-2.03 3.8-4.4 9.61-5.26 12.91-0.88 3.4-1.56 10.11-1.56 15.5 0 5.39 0.68 12.09 1.56 15.5 0.86 3.3 3.33 9.15 5.49 13 2.16 3.85 6.07 9.26 8.69 12.01 2.62 2.76 8.14 7.12 12.27 9.69 4.24 2.64 10.76 5.6 15 6.82 4.79 1.37 11.65 2.33 19 2.66 9.24 0.42 13.47 0.11 21.5-1.56 7.38-1.53 12.73-3.45 20.43-7.34 8.77-4.44 11.9-6.72 19.57-14.28 7.23-7.13 10.2-10.98 14.28-18.5 3.65-6.72 5.97-12.72 7.94-20.5l2.78-11v-344.16c-4.57-9.56-5.86-10.88-10-12.91-4.06-1.99-6.41-2.43-12.5-2.34-4.13 0.07-13.8 1.41-21.5 2.99z"
        />
      </svg>
    </svg>
  )
}

export function FileKindIcon({ kind, label, ...props }: IconProps & { kind: FileKind; label?: string }) {
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
      return <PaperIcon {...props} label={label} />
  }
}

/** Top-left wordmark: fluffy all-curves cloud (mint→sky gradient outline) + "Webshare". */
export function WebshareLogo({ alwaysText = false }: { alwaysText?: boolean } = {}) {
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
      <span className={`display-font text-lg font-bold text-[var(--ink)] ${alwaysText ? 'hidden min-[280px]:inline' : 'hidden min-[410px]:inline'}`}>Webshare</span>
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

export function TriangleInfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
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

/* file view-mode toggle glyphs */
export function ViewIconsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </Svg>
  )
}

export function ViewListIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </Svg>
  )
}

export function ViewColumnsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {/* wide rect, dividers on exact thirds so all three columns match */}
      <rect x="2" y="4.5" width="20" height="15" rx="2" />
      <path d="M8.67 4.5v15M15.33 4.5v15" />
    </Svg>
  )
}

export function ViewGalleryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="12.5" rx="2" />
      {/* filmstrip: four filled squares flush with the canvas edges */}
      {/* row spans 2..22 to match the canvas's stroked outer edges */}
      <rect x="2" y="17.5" width="3.5" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="7.5" y="17.5" width="3.5" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="13" y="17.5" width="3.5" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="18.5" y="17.5" width="3.5" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
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

export function FolderIcon({ size = 20, className }: IconProps) {
  const id = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#FBBF24"
      stroke="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <filter id={id} x="0" y="-30%" width="100%" height="150%">
          <feDropShadow dx="0" dy="-1" stdDeviation="0.5" floodColor="rgba(0,0,0,0.12)" />
        </filter>
      </defs>
      <path d="M22 19.5a1.5 1.5 0 0 1-1.5 1.5H3.5a1.5 1.5 0 0 1-1.5-1.5V6a1.5 1.5 0 0 1 1.5-1.5h4.38a1.5 1.5 0 0 1 1.06 0.44l0.62 0.62a1.5 1.5 0 0 0 1.06 0.44h9.88a1.5 1.5 0 0 1 1.5 1.5z" opacity="0.9" />
      <path d="M3 20h18a1 1 0 0 0 1-1V9a1.5 1.5 0 0 0-1.5-1.5H3.5a1.5 1.5 0 0 0-1.5 1.5V19a1 1 0 0 0 1 1z" filter={`url(#${id})`} />
    </svg>
  )
}

export function FolderToFilesIcon(props: IconProps) {
  const width = props.size ? props.size * 2 : 48
  const height = props.size || 24
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 48 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden="true"
    >
      {/* folder — right edge broken where arrow exits */}
      <path d="M 18 14.5 v 2.5 a 2 2 0 0 1 -2 2 H 4 a 2 2 0 0 1 -2 -2 V 7 a 2 2 0 0 1 2 -2 h 4.5 l 2 2 h 5.5 a 2 2 0 0 1 2 2 v 2" />
      {/* arrow → tail at folder center */}
      <path d="M 11.5 12 h 15 M 22.5 8 l 4 4 l -4 4" />
      {/* back paper (top-right) */}
      <path d="M 34 7 V 5 a 2 2 0 0 1 2 -2 h 5 l 4 4 v 8 a 2 2 0 0 1 -2 2 h -2" />
      <path d="M 41 3 v 3 a 1 1 0 0 0 1 1 h 3" />
      {/* front paper (bottom-left of stack) */}
      <path d="M 30 19 V 9 a 2 2 0 0 1 2 -2 h 5 l 4 4 v 8 a 2 2 0 0 1 -2 2 h -7 a 2 2 0 0 1 -2 -2 z" />
      <path d="M 37 7 v 3 a 1 1 0 0 0 1 1 h 3" />
    </svg>
  )
}
