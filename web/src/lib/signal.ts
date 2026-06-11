import type { DeviceKind, PeerInfo } from '../types'

export type SignalState = 'connecting' | 'open' | 'closed'

interface Hello {
  name: string
  device: DeviceKind
  pfp: string | null
}

type ServerMsg =
  | { t: 'you'; id: string }
  | { t: 'peers'; peers: PeerInfo[] }
  | { t: 'msg'; from: string; data: unknown }

/**
 * Resolve the signaling server URL:
 * 1. VITE_SIGNAL_URL (set as a GitHub repo Variable for production builds)
 * 2. dev fallback: `wrangler dev` on port 8787 of the same host serving the app,
 *    so phones on your Wi-Fi reach it via the Mac's LAN IP automatically.
 */
export function signalUrl(): string {
  const fromEnv = import.meta.env.VITE_SIGNAL_URL as string | undefined
  if (fromEnv) return fromEnv
  const host = location.hostname
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return `ws://${host}:8787/ws`
  }
  // production default — replace once the worker is deployed, or set VITE_SIGNAL_URL
  return 'wss://webshare-signal.REPLACE-WITH-YOUR-SUBDOMAIN.workers.dev/ws'
}

/** Anonymous WebSocket client for the webshare signaling worker, with auto-reconnect. */
export class SignalClient {
  myId: string | null = null
  onState: (state: SignalState) => void = () => {}
  onPeers: (peers: PeerInfo[]) => void = () => {}
  onMessage: (from: string, data: unknown) => void = () => {}

  private readonly url: string
  private socket: WebSocket | null = null
  private hello: Hello | null = null
  private explicitlyClosed = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(url: string) {
    this.url = url
  }

  connect(): void {
    if (this.explicitlyClosed) return
    this.onState('connecting')
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.addEventListener('open', () => {
      this.attempt = 0
      this.onState('open')
      if (this.hello) socket.send(JSON.stringify({ t: 'hello', ...this.hello }))
    })

    socket.addEventListener('message', (ev) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      if (msg.t === 'you') this.myId = msg.id
      else if (msg.t === 'peers') this.onPeers(msg.peers)
      else if (msg.t === 'msg') this.onMessage(msg.from, msg.data)
    })

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.explicitlyClosed) {
        this.onState('closed')
        return
      }
      const delay = Math.min(1000 * 2 ** this.attempt++, 15000)
      this.onState('connecting')
      this.timer = setTimeout(() => this.connect(), delay)
    })
  }

  /** Set (and immediately broadcast) our identity; re-sent automatically on every reconnect. */
  setHello(hello: Hello): void {
    this.hello = hello
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ t: 'hello', ...hello }))
    }
  }

  sendTo(to: string, data: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ t: 'msg', to, data }))
    }
  }

  close(): void {
    this.explicitlyClosed = true
    clearTimeout(this.timer)
    this.socket?.close()
    this.socket = null
  }
}
