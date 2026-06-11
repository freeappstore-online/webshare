import type { DeviceKind } from '../types'

/** Best-effort device classification from the user agent, used for fallback avatars. */
export function detectDevice(): DeviceKind {
  const ua = navigator.userAgent
  if (/watch/i.test(ua)) return 'watch'
  // iPadOS reports as Macintosh but has touch
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet'
  if (/Android(?!.*Mobile)/i.test(ua)) return 'tablet'
  if (/Mobi|iPhone|Android/i.test(ua)) return 'phone'
  if (/Macintosh|Windows/.test(ua)) return 'laptop'
  return 'desktop'
}

export const DEVICE_LABEL: Record<DeviceKind, string> = {
  phone: 'Phone',
  tablet: 'Tablet',
  laptop: 'Laptop',
  desktop: 'Desktop',
  watch: 'Watch',
}
