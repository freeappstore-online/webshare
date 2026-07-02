/**
 * Share codes: a 6-digit code puts sender and receiver in the same signaling
 * room regardless of their IPs — the escape hatch for campus/carrier networks
 * that split devices behind different public addresses.
 */

export const SHARE_CODE_LENGTH = 6

export function generateShareCode(): string {
  const digits = new Uint8Array(SHARE_CODE_LENGTH)
  crypto.getRandomValues(digits)
  return Array.from(digits, (d) => d % 10).join('')
}

export const isShareCode = (text: string): boolean =>
  new RegExp(`^\\d{${SHARE_CODE_LENGTH}}$`).test(text)

/** Room name for a code, namespaced apart from the `ip:` rooms. */
export const codeRoom = (code: string): string => `code:${code}`

/**
 * URL encoded into the sender's QR — scanning it with a native camera app
 * opens webshare and auto-joins the room (handled on load in App).
 */
export const codeUrl = (code: string): string =>
  `${location.origin}${location.pathname}?code=${code}`

/** Pull a share code out of scanned QR text: the bare code or a webshare URL. */
export function parseScannedCode(text: string): string | null {
  const trimmed = text.trim()
  if (isShareCode(trimmed)) return trimmed
  try {
    const code = new URL(trimmed).searchParams.get('code')
    return code && isShareCode(code) ? code : null
  } catch {
    return null
  }
}
