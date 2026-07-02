import { useEffect, useState } from 'react'
import { codeUrl } from '../lib/shareCode'

/**
 * QR for a share code, encoding the app URL with ?code= — scanning it with a
 * native camera app opens webshare and auto-joins. Renders nothing until the
 * lazy-loaded encoder finishes (it's fast).
 */
export function QrImage({ code, className }: { code: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    void import('qrcode').then(async ({ default: QRCode }) => {
      const url = await QRCode.toDataURL(codeUrl(code), { margin: 1, width: 480 })
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [code])

  if (!src) return null
  return <img src={src} alt={`QR code for share code ${code}`} className={className} />
}
