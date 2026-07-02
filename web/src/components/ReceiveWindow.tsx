import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@freeappstore/sdk/ui'
import { parseScannedCode } from '../lib/shareCode'
import { CodeInput } from './CodeInput'
import { CloseIcon, QrCodeIcon } from './icons'
import { FloatingWindow } from './FloatingWindow'
import { PeerAvatar } from './PeerAvatar'
import type { IncomingRequest } from '../types'

interface ReceiveWindowProps {
  open: boolean
  /** Set while joined to a code room as receiver — shows the waiting view. */
  joinedCode: string | null
  /** A request already auto-accepted in this room (code = consent). */
  accepted: IncomingRequest | null
  onJoin: (code: string) => void
  /** Leave the code room (Cancel while waiting, or closing the window). */
  onLeave: () => void
  onClose: () => void
}

/** Receiver flow: type the sender's 6-digit share code (or scan their QR). */
export function ReceiveWindow({ open, joinedCode, accepted, onJoin, onLeave, onClose }: ReceiveWindowProps) {
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // fresh window every time it opens
  useEffect(() => {
    if (open) {
      setCode('')
      setScanning(false)
      setScanError(null)
    }
  }, [open])

  // camera + decode loop, only while the scan view is up
  useEffect(() => {
    if (!scanning || !open) return
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false
    const canvas = document.createElement('canvas')

    void (async () => {
      try {
        const [{ default: jsQR }, media] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }),
        ])
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop())
          return
        }
        stream = media
        const video = videoRef.current!
        video.srcObject = media
        await video.play()
        const tick = () => {
          if (cancelled) return
          if (video.videoWidth) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!
            ctx.drawImage(video, 0, 0)
            const found = jsQR(
              ctx.getImageData(0, 0, canvas.width, canvas.height).data,
              canvas.width,
              canvas.height,
            )
            const scanned = found && parseScannedCode(found.data)
            if (scanned) {
              setScanning(false)
              setCode(scanned)
              onJoin(scanned)
              return
            }
          }
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        if (!cancelled) setScanError("Couldn't open the camera — type the code instead.")
        setScanning(false)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [scanning, open, onJoin])

  const close = () => {
    // closing while waiting also backs out of the sender's room
    if (joinedCode) onLeave()
    onClose()
  }

  return (
    <FloatingWindow open={open} closeOnBackdrop onClose={close}>
      {joinedCode && accepted ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <PeerAvatar pfp={accepted.from.pfp} device={null} name={accepted.from.name} size={80} />
            <p className="text-xl font-bold text-[var(--ink)]" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em' }}>
              {accepted.from.name}
            </p>
          </div>
          <p className="flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
            <Spinner size={14} />
            is sending {accepted.total} item{accepted.total === 1 ? '' : 's'}…
          </p>
          <button
            onClick={close}
            className="min-h-11 w-full cursor-pointer rounded-full border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
          >
            Cancel
          </button>
        </div>
      ) : joinedCode ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <h2 className="text-xl font-bold text-[var(--ink)]">Connected</h2>
          <p className="pl-[0.3em] text-3xl font-bold tracking-[0.3em] text-[var(--ink)]">{joinedCode}</p>
          <p className="flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
            <Spinner size={14} />
            Waiting for the sender to pick you…
          </p>
          <button
            onClick={close}
            className="min-h-11 w-full cursor-pointer rounded-full border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
          >
            Cancel
          </button>
        </div>
      ) : scanning ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <h2 className="text-xl font-bold text-[var(--ink)]">Scan QR Code</h2>
          <video
            ref={videoRef}
            muted
            playsInline
            className="aspect-square w-full rounded-[var(--radius-sm)] bg-black object-cover"
          />
          <p className="text-sm text-[var(--muted)]">Point at the QR code on the sender's screen</p>
          <button
            onClick={() => setScanning(false)}
            className="min-h-11 w-full cursor-pointer rounded-full border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
          >
            Enter code instead
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-2">
          <h2 className="text-center text-xl font-bold text-[var(--ink)]">Enter Share Code</h2>
          <CodeInput value={code} onChange={setCode} onComplete={onJoin} />
          <p className="text-center text-xs text-[var(--muted)]">
            The sender finds it under “Show share code”
          </p>
          <div className="h-px bg-[var(--line-strong)]" />
          <button
            onClick={() => {
              setScanError(null)
              setScanning(true)
            }}
            className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--panel)] font-bold text-[var(--ink)]"
          >
            <QrCodeIcon size={18} />
            Scan QR Code
          </button>
          {scanError && <p className="text-center text-xs text-[var(--error)]">{scanError}</p>}
          <button
            onClick={close}
            aria-label="Cancel"
            className="flex cursor-pointer items-center justify-center self-center rounded-full p-2 text-[var(--muted)] transition-colors hover:bg-[var(--line-strong)] hover:text-[var(--ink)]"
          >
            <CloseIcon size={20} />
          </button>
        </div>
      )}
    </FloatingWindow>
  )
}
