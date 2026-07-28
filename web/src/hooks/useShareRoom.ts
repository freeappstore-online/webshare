import { useCallback, useEffect, useRef, useState } from 'react'
import { detectDevice } from '../lib/device'
import { toFileMeta } from '../lib/files'
import { codeRoom } from '../lib/shareCode'
import { SignalClient, signalUrl, type SignalState } from '../lib/signal'
import type { SaveTarget } from '../lib/saveTarget'
import { Transfer } from '../lib/transfer'
import type {
  FileMeta,
  IncomingRequest,
  OutgoingRequest,
  PeerInfo,
  PeerMsg,
  Profile,
  TransferProgress,
} from '../types'

/** Keep huge batches displayable — the popup shows the first 800 + "N more". */
const MAX_METAS_PER_REQUEST = 800

/** The worker silently drops messages over 64K chars — stay well under it. */
const MAX_MSG_CHARS = 60 * 1024

/** Senders can pile up while a request is on screen; keep a sane backlog. */
const MAX_INCOMING_QUEUE = 8

export type CodeRole = 'send' | 'receive'

/**
 * Connects to the self-hosted signaling worker. People behind the same public
 * IP (= same local network) see each other; share requests are relayed
 * peer-to-peer through it. No accounts involved.
 *
 * A share code opens a *second* connection into the code's room — senders host
 * one so cross-network receivers can reach them, without ever leaving the
 * IP room (LAN discovery keeps working). Peer lists from both are merged.
 */
export function useShareRoom(profile: Profile, discoverable: boolean) {
  const [connection, setConnection] = useState<SignalState>('connecting')
  // two rosters: same-network people, and people who entered our share code
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [codePeers, setCodePeers] = useState<PeerInfo[]>([])
  // requests queue up instead of overwriting each other; the head is on screen
  const [incomingQueue, setIncomingQueue] = useState<IncomingRequest[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([])
  // active share code and which side of it we are (sender hosts, receiver joins)
  const [codeSession, setCodeSession] = useState<{ code: string; role: CodeRole } | null>(null)
  // last share request auto-accepted because it arrived through our code room
  const [autoAccepted, setAutoAccepted] = useState<IncomingRequest | null>(null)
  const codeSessionRef = useRef(codeSession)
  codeSessionRef.current = codeSession

  const [debouncedDiscoverable, setDebouncedDiscoverable] = useState(discoverable)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedDiscoverable(discoverable), 400)
    return () => clearTimeout(t)
  }, [discoverable])

  // in-flight (and just-finished) transfers, newest last
  const [transfers, setTransfers] = useState<TransferProgress[]>([])

  const clientRef = useRef<SignalClient | null>(null) // default IP room
  const codeClientRef = useRef<SignalClient | null>(null) // extra code room
  const ipPeersRef = useRef<PeerInfo[]>([])
  const codePeersRef = useRef<PeerInfo[]>([])
  // peer ids are per-connection — remember which connection can reach each id
  const peerSourceRef = useRef(new Map<string, SignalClient>())

  // live transfer engines, and the staged Files waiting for an accept
  const transfersRef = useRef(new Map<string, { transfer: Transfer; peerId: string }>())
  const pendingSendsRef = useRef(new Map<string, { peer: PeerInfo; files: File[] }>())

  /** The connection that can reach a peer id (falls back to the IP room). */
  const clientFor = useCallback(
    (peerId: string): SignalClient | null => peerSourceRef.current.get(peerId) ?? clientRef.current,
    []
  )

  const patchTransfer = useCallback((reqId: string, patch: Partial<TransferProgress>) => {
    setTransfers((prev) => prev.map((t) => (t.reqId === reqId ? { ...t, ...patch } : t)))
  }, [])

  /**
   * Build a Transfer plus its progress row. Both sides go through here — the
   * only difference is who supplies the Files and who supplies the SaveTarget.
   */
  const startTransfer = useCallback(
    (opts: {
      reqId: string
      peer: PeerInfo
      dir: 'send' | 'recv'
      files?: File[]
      target?: SaveTarget | null
    }) => {
      const { reqId, peer, dir } = opts
      if (transfersRef.current.has(reqId)) return

      const transfer = new Transfer({
        reqId,
        role: dir === 'send' ? 'sender' : 'receiver',
        files: opts.files,
        target: opts.target,
        handlers: {
          onSignal: (msg) => void clientFor(peer.id)?.sendTo(peer.id, msg),
          onProgress: (stats) => patchTransfer(reqId, { ...stats, state: 'transferring' }),
          onDone: () =>
            patchTransfer(reqId, {
              state: 'done',
              currentName: null,
              savedTo: opts.target?.label ?? null,
            }),
          onError: (error) => patchTransfer(reqId, { state: 'error', error }),
          onRemoteCancel: () =>
            patchTransfer(reqId, {
              state: 'cancelled',
              error: `${peer.name} cancelled the transfer`,
            }),
          onReport: (report) => patchTransfer(reqId, { report }),
        },
      })

      transfersRef.current.set(reqId, { transfer, peerId: peer.id })
      setTransfers((prev) => [
        ...prev.filter((t) => t.reqId !== reqId),
        {
          reqId,
          dir,
          peerId: peer.id,
          peerName: peer.name,
          peerPfp: peer.pfp,
          state: 'connecting',
          savedTo: null,
          error: null,
          report: null,
          startedAt: Date.now(),
          ...transfer.progress,
        },
      ])
      transfer.start()
    },
    [patchTransfer, clientFor]
  )

  const mergePeers = useCallback(() => {
    const byName = (a: PeerInfo, b: PeerInfo) => a.name.localeCompare(b.name)
    // the same person can sit in both rooms (on our Wi-Fi *and* typed the
    // code) — show them only in the share-code section
    const inCode = new Set(codePeersRef.current.map((p) => `${p.name}|${p.device}|${p.pfp ?? ''}`))
    setCodePeers([...codePeersRef.current].sort(byName))
    setPeers(
      ipPeersRef.current.filter((p) => !inCode.has(`${p.name}|${p.device}|${p.pfp ?? ''}`)).sort(byName)
    )
  }, [])

  const handleMessage = useCallback((client: SignalClient, from: string, data: unknown) => {
    peerSourceRef.current.set(from, client)
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
      // we typed this sender's code — that already was the consent, so there's
      // no Accept/Decline prompt; the receive window just asks where to save
      // (the picker needs a click, so the accept is still sent from there)
      if (client === codeClientRef.current && codeSessionRef.current?.role === 'receive') {
        setAutoAccepted(req)
        return
      }
      setIncomingQueue((prev) =>
        prev.some((r) => r.reqId === req.reqId) || prev.length >= MAX_INCOMING_QUEUE ? prev : [...prev, req]
      )
    } else if (m?.t === 'share-resp') {
      // only settle live requests — a response must not overwrite 'withdrawn'
      setOutgoing((prev) =>
        prev.map((o) => o.reqId === m.reqId && o.status === 'waiting' ? { ...o, status: m.accept ? 'accepted' : 'declined' } : o)
      )
      // withdrawing drops the staged files, so a late "accept" finds nothing
      // here and correctly sends nothing
      const staged = pendingSendsRef.current.get(m.reqId)
      pendingSendsRef.current.delete(m.reqId)
      if (m.accept && staged) {
        startTransfer({ reqId: m.reqId, peer: staged.peer, dir: 'send', files: staged.files })
      }
    } else if (m?.t === 'rtc-offer' && typeof m.sdp === 'string') {
      void transfersRef.current.get(m.reqId)?.transfer.handleOffer(m.sdp)
    } else if (m?.t === 'rtc-answer' && typeof m.sdp === 'string') {
      void transfersRef.current.get(m.reqId)?.transfer.handleAnswer(m.sdp)
    } else if (m?.t === 'rtc-ice' && m.candidate) {
      void transfersRef.current.get(m.reqId)?.transfer.handleIce(m.candidate)
    } else if (m?.t === 'xfer-abort') {
      transfersRef.current.get(m.reqId)?.transfer.remoteAbort()
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
  }, [startTransfer])

  // default (IP room) connection — lives as long as the app
  useEffect(() => {
    const client = new SignalClient(signalUrl())
    clientRef.current = client

    client.onState = (state) => {
      setConnection(state)
      // the roster is connection-scoped — anyone shown while we're offline is
      // a ghost that can be tapped but never reached
      if (state !== 'open') {
        ipPeersRef.current = []
        mergePeers()
      }
    }
    client.onPeers = (list) => {
      ipPeersRef.current = list
      for (const p of list) peerSourceRef.current.set(p.id, client)
      mergePeers()
    }
    client.onMessage = (from, data) => handleMessage(client, from, data)
    client.connect()

    return () => {
      client.close()
      clientRef.current = null
    }
  }, [handleMessage, mergePeers])

  // code-room connection — only while a share code is active
  useEffect(() => {
    if (!codeSession) return
    const client = new SignalClient(signalUrl(), codeRoom(codeSession.code))
    codeClientRef.current = client

    client.onState = (state) => {
      if (state !== 'open') {
        codePeersRef.current = []
        mergePeers()
      }
    }
    client.onPeers = (list) => {
      codePeersRef.current = list
      for (const p of list) peerSourceRef.current.set(p.id, client)
      mergePeers()
    }
    client.onMessage = (from, data) => handleMessage(client, from, data)
    client.connect()

    return () => {
      client.close()
      codeClientRef.current = null
      codePeersRef.current = []
      mergePeers()
    }
  }, [codeSession, handleMessage, mergePeers])

  // announce or retract identity in the IP room based on discoverability
  useEffect(() => {
    if (debouncedDiscoverable) {
      clientRef.current?.setHello({ name: profile.name, device: detectDevice(), pfp: profile.pfp })
    } else {
      clientRef.current?.clearHello()
    }
  }, [profile, debouncedDiscoverable])

  // in the code room only receivers announce — entering the sender's code is
  // the opt-in; the hosting sender stays invisible there
  useEffect(() => {
    if (codeSession?.role === 'receive') {
      codeClientRef.current?.setHello({ name: profile.name, device: detectDevice(), pfp: profile.pfp })
    }
  }, [profile, codeSession])

  const sendShareRequest = useCallback((peer: PeerInfo, toSend: File[]) => {
    const reqId = crypto.randomUUID().slice(0, 8)
    const metas = toSend.map(toFileMeta)
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
    if (!clientFor(peer.id)?.sendTo(peer.id, msg)) return
    // hold the actual Files until they accept — that's when bytes start moving
    pendingSendsRef.current.set(reqId, { peer, files: toSend })
    setOutgoing((prev) => [...prev, { reqId, toId: peer.id, toName: peer.name, status: 'waiting' }])
  }, [profile, clientFor])

  /**
   * Answer a share request. On accept, `target` is where the files will be
   * written — the receiver side of the transfer is registered *before* the
   * accept goes out, so the sender's offer can't arrive too early.
   */
  const respondToShare = useCallback((req: IncomingRequest, accept: boolean, target?: SaveTarget | null) => {
    if (!req.withdrawn) {
      if (accept) startTransfer({ reqId: req.reqId, peer: req.from, dir: 'recv', target })
      const msg: PeerMsg = { t: 'share-resp', reqId: req.reqId, accept }
      clientFor(req.from.id)?.sendTo(req.from.id, msg)
    }
    setIncomingQueue((prev) => prev.filter((r) => r.reqId !== req.reqId))
    setAutoAccepted((prev) => (prev?.reqId === req.reqId ? null : prev))
  }, [clientFor, startTransfer])

  const withdrawShareRequest = useCallback((reqId: string, toId: string) => {
    clientFor(toId)?.sendTo(toId, { t: 'share-cancel', reqId } as PeerMsg)
    // drop the staged files so an accept that crosses the withdrawal in flight
    // doesn't start a transfer the sender already backed out of
    pendingSendsRef.current.delete(reqId)
    setOutgoing((prev) => prev.map((o) => o.reqId === reqId ? { ...o, status: 'withdrawn' } : o))
  }, [clientFor])

  /** Stop a running transfer from this side and tell the peer. */
  const cancelTransfer = useCallback((reqId: string) => {
    transfersRef.current.get(reqId)?.transfer.cancel()
    patchTransfer(reqId, { state: 'cancelled', error: null })
  }, [patchTransfer])

  /** Close a finished/failed transfer's window. */
  const dismissTransfer = useCallback((reqId: string) => {
    transfersRef.current.get(reqId)?.transfer.dispose()
    transfersRef.current.delete(reqId)
    setTransfers((prev) => prev.filter((t) => t.reqId !== reqId))
  }, [])

  // never leave a writable file handle dangling when the app goes away
  useEffect(() => {
    const engines = transfersRef.current
    return () => {
      for (const { transfer } of engines.values()) transfer.dispose()
      engines.clear()
    }
  }, [])

  const clearOutgoing = useCallback((reqId: string) => {
    setOutgoing((prev) => prev.filter((o) => o.reqId !== reqId))
  }, [])

  const dismissIncoming = useCallback(() => setIncomingQueue((prev) => prev.slice(1)), [])

  const joinRoom = useCallback((code: string, role: CodeRole) => {
    setCodeSession({ code, role })
    setAutoAccepted(null)
  }, [])

  const leaveRoom = useCallback(() => {
    setCodeSession(null)
    setAutoAccepted(null)
  }, [])

  const incoming = incomingQueue[0] ?? null
  const roomCode = codeSession?.code ?? null
  const codeRole = codeSession?.role ?? null

  return { connection, peers, codePeers, incoming, outgoing, roomCode, codeRole, autoAccepted, transfers, joinRoom, leaveRoom, sendShareRequest, withdrawShareRequest, respondToShare, cancelTransfer, dismissTransfer, clearOutgoing, dismissIncoming }
}
