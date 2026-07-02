import { useCallback, useEffect, useRef, useState } from 'react'
import { detectDevice } from '../lib/device'
import { SignalClient, signalUrl, type SignalState } from '../lib/signal'
import type {
  FileMeta,
  IncomingRequest,
  OutgoingRequest,
  PeerInfo,
  PeerMsg,
  Profile,
} from '../types'

/** Keep huge batches displayable — the popup shows the first 800 + "N more". */
const MAX_METAS_PER_REQUEST = 800

/** The worker silently drops messages over 64K chars — stay well under it. */
const MAX_MSG_CHARS = 60 * 1024

/** Senders can pile up while a request is on screen; keep a sane backlog. */
const MAX_INCOMING_QUEUE = 8

/**
 * Connects to the self-hosted signaling worker. People behind the same public
 * IP (= same local network) see each other; share requests are relayed
 * peer-to-peer through it. No accounts involved.
 */
export function useShareRoom(profile: Profile, discoverable: boolean) {
  const [connection, setConnection] = useState<SignalState>('connecting')
  const [peers, setPeers] = useState<PeerInfo[]>([])
  // requests queue up instead of overwriting each other; the head is on screen
  const [incomingQueue, setIncomingQueue] = useState<IncomingRequest[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([])

  const [debouncedDiscoverable, setDebouncedDiscoverable] = useState(discoverable)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedDiscoverable(discoverable), 400)
    return () => clearTimeout(t)
  }, [discoverable])

  const clientRef = useRef<SignalClient | null>(null)

  useEffect(() => {
    const client = new SignalClient(signalUrl())
    clientRef.current = client

    client.onState = (state) => {
      setConnection(state)
      // the roster is connection-scoped — anyone shown while we're offline is
      // a ghost that can be tapped but never reached
      if (state !== 'open') setPeers([])
    }
    client.onPeers = (list) => {
      setPeers([...list].sort((a, b) => a.name.localeCompare(b.name)))
    }
    client.onMessage = (from, data) => {
      const m = data as PeerMsg
      if (m?.t === 'share-req' && typeof m.reqId === 'string') {
        // payload comes straight from an untrusted peer — clamp what we render
        const files = Array.isArray(m.files) ? m.files.slice(0, MAX_METAS_PER_REQUEST) : []
        const req: IncomingRequest = {
          from: { id: from, name: String(m.name ?? '').slice(0, 40) || 'Someone', device: m.device, pfp: typeof m.pfp === 'string' ? m.pfp : null },
          reqId: m.reqId,
          total: Number.isFinite(m.total) ? Math.max(m.total, files.length) : files.length,
          files,
        }
        setIncomingQueue((prev) =>
          prev.some((r) => r.reqId === req.reqId) || prev.length >= MAX_INCOMING_QUEUE ? prev : [...prev, req]
        )
      } else if (m?.t === 'share-resp') {
        // only settle live requests — a response must not overwrite 'withdrawn'
        setOutgoing((prev) =>
          prev.map((o) => o.reqId === m.reqId && o.status === 'waiting' ? { ...o, status: m.accept ? 'accepted' : 'declined' } : o)
        )
      } else if (m?.t === 'share-cancel') {
        setIncomingQueue((prev) => {
          const idx = prev.findIndex((r) => r.reqId === m.reqId)
          if (idx === -1) return prev
          // the one on screen flips to "withdrew sharing"; queued ones the user
          // never saw just vanish
          if (idx === 0) return [{ ...prev[0], withdrawn: true }, ...prev.slice(1)]
          return prev.filter((_, i) => i !== idx)
        })
      }
    }
    client.connect()

    return () => {
      client.close()
      clientRef.current = null
    }
  }, [])

  // announce or retract identity based on discoverability
  useEffect(() => {
    if (debouncedDiscoverable) {
      clientRef.current?.setHello({ name: profile.name, device: detectDevice(), pfp: profile.pfp })
    } else {
      clientRef.current?.clearHello()
    }
  }, [profile, debouncedDiscoverable])

  const sendShareRequest = useCallback((peer: PeerInfo, metas: FileMeta[]) => {
    const reqId = crypto.randomUUID().slice(0, 8)
    const base = {
      t: 'share-req' as const,
      reqId,
      total: metas.length,
      name: profile.name,
      device: detectDevice(),
      pfp: profile.pfp,
    }
    // trim the preview list to the worker's message cap — an oversized relay
    // is dropped silently server-side and the receiver never sees the request
    let budget = MAX_MSG_CHARS - JSON.stringify({ t: 'msg', to: peer.id, data: { ...base, files: [] } }).length
    const files: FileMeta[] = []
    for (const meta of metas) {
      if (files.length >= MAX_METAS_PER_REQUEST) break
      const cost = JSON.stringify(meta).length + 1
      if (cost > budget) break
      budget -= cost
      files.push(meta)
    }
    const msg: PeerMsg = { ...base, files }
    // don't show a "Waiting…" that can never resolve if the socket is down
    if (!clientRef.current?.sendTo(peer.id, msg)) return
    setOutgoing((prev) => [...prev, { reqId, toId: peer.id, toName: peer.name, status: 'waiting' }])
  }, [profile])

  const respondToShare = useCallback((req: IncomingRequest, accept: boolean) => {
    if (!req.withdrawn) {
      const msg: PeerMsg = { t: 'share-resp', reqId: req.reqId, accept }
      clientRef.current?.sendTo(req.from.id, msg)
    }
    setIncomingQueue((prev) => prev.filter((r) => r.reqId !== req.reqId))
  }, [])

  const withdrawShareRequest = useCallback((reqId: string, toId: string) => {
    clientRef.current?.sendTo(toId, { t: 'share-cancel', reqId } as PeerMsg)
    setOutgoing((prev) => prev.map((o) => o.reqId === reqId ? { ...o, status: 'withdrawn' } : o))
  }, [])

  const clearOutgoing = useCallback((reqId: string) => {
    setOutgoing((prev) => prev.filter((o) => o.reqId !== reqId))
  }, [])

  const dismissIncoming = useCallback(() => setIncomingQueue((prev) => prev.slice(1)), [])

  const incoming = incomingQueue[0] ?? null

  return { connection, peers, incoming, outgoing, sendShareRequest, withdrawShareRequest, respondToShare, clearOutgoing, dismissIncoming }
}
