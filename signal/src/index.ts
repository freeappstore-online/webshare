/**
 * webshare signaling server (Cloudflare Worker + Durable Object).
 *
 * Anonymous, stateless rendezvous: no accounts, no storage, nothing logged.
 * Peers behind the same public IP (= same home/office network) land in the
 * same room and can see each other; everything else is relayed peer-to-peer.
 *
 * Wire protocol (JSON over WebSocket):
 *   client → server:
 *     { t: 'hello', name, device, pfp }    announce/update identity
 *     { t: 'msg', to, data }               relay `data` to peer `to`
 *   server → client:
 *     { t: 'you', id }                     your server-assigned peer id
 *     { t: 'peers', peers: [...] }         everyone else in your room (after their hello)
 *     { t: 'msg', from, data }             relayed payload
 */

export interface Env {
  ROOMS: DurableObjectNamespace
}

const MAX_MSG_BYTES = 64 * 1024
const MAX_PFP_CHARS = 16 * 1024
const MAX_NAME_CHARS = 40
const DEVICES = new Set(['phone', 'tablet', 'laptop', 'desktop', 'watch'])

interface Attachment {
  id: string
  name?: string
  device?: string
  pfp?: string | null
}

export class RoomDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    // Hibernation API: the DO can sleep between messages, attachments persist.
    this.state.acceptWebSocket(server)
    const att: Attachment = { id: crypto.randomUUID() }
    server.serializeAttachment(att)
    server.send(JSON.stringify({ t: 'you', id: att.id }))
    // Send the current roster immediately so late-joining clients see peers
    // that announced before this connection was established.
    this.broadcastRoster()
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return
    let msg: { t?: string; [k: string]: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const att = ws.deserializeAttachment() as Attachment

    if (msg.t === 'hello') {
      const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, MAX_NAME_CHARS) : ''
      if (!name) return
      const device = typeof msg.device === 'string' && DEVICES.has(msg.device) ? msg.device : 'desktop'
      const pfp =
        typeof msg.pfp === 'string' && msg.pfp.startsWith('data:image/') && msg.pfp.length <= MAX_PFP_CHARS
          ? msg.pfp
          : null
      ws.serializeAttachment({ ...att, name, device, pfp })
      this.broadcastRoster()
      return
    }

    if (msg.t === 'msg' && typeof msg.to === 'string') {
      for (const peer of this.state.getWebSockets()) {
        const peerAtt = peer.deserializeAttachment() as Attachment
        if (peerAtt.id === msg.to) {
          try {
            peer.send(JSON.stringify({ t: 'msg', from: att.id, data: msg.data }))
          } catch {
            // peer is gone; roster will refresh on its close event
          }
          return
        }
      }
    }
  }

  // the closing socket is still in getWebSockets() while these handlers run,
  // so it must be excluded explicitly or leavers linger in everyone's roster
  webSocketClose(ws: WebSocket): void {
    this.broadcastRoster(ws)
  }

  webSocketError(ws: WebSocket): void {
    this.broadcastRoster(ws)
  }

  /** Send each socket the list of *other* peers that have said hello. */
  private broadcastRoster(exclude?: WebSocket): void {
    const entries = this.state
      .getWebSockets()
      .filter((ws) => ws !== exclude)
      .map((ws) => ({
        ws,
        att: ws.deserializeAttachment() as Attachment,
      }))
    for (const { ws, att } of entries) {
      const peers = entries
        .filter((e) => e.att.id !== att.id && e.att.name)
        .map((e) => ({ id: e.att.id, name: e.att.name, device: e.att.device, pfp: e.att.pfp ?? null }))
      try {
        ws.send(JSON.stringify({ t: 'peers', peers }))
      } catch {
        // closing socket; its close event will re-broadcast
      }
    }
  }
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      // Same public IP = same local network. `?room=` overrides for manual
      // room codes (e.g. when carrier NAT splits people who are together).
      const ip = request.headers.get('CF-Connecting-IP') ?? 'dev'
      const room = url.searchParams.get('room')?.slice(0, 64) || `ip:${ip}`
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request)
    }
    return new Response('webshare signaling server — connect via /ws\n', {
      headers: { 'content-type': 'text/plain' },
    })
  },
}
