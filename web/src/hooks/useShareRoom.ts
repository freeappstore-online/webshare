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

/**
 * Connects to the self-hosted signaling worker. People behind the same public
 * IP (= same local network) see each other; share requests are relayed
 * peer-to-peer through it. No accounts involved.
 */
export function useShareRoom(profile: Profile, discoverable: boolean) {
  const [connection, setConnection] = useState<SignalState>('connecting')
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null)
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([])

  const clientRef = useRef<SignalClient | null>(null)

  useEffect(() => {
    const client = new SignalClient(signalUrl())
    clientRef.current = client

    client.onState = setConnection
    client.onPeers = (list) => {
      setPeers([...list].sort((a, b) => a.name.localeCompare(b.name)))
    }
    client.onMessage = (from, data) => {
      const m = data as PeerMsg
      if (m?.t === 'share-req') {
        setIncoming({
          from: { id: from, name: m.name, device: m.device, pfp: m.pfp },
          reqId: m.reqId,
          total: m.total,
          files: m.files,
        })
      } else if (m?.t === 'share-resp') {
        setOutgoing((prev) =>
          prev.map((o) => o.reqId === m.reqId ? { ...o, status: m.accept ? 'accepted' : 'declined' } : o)
        )
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
    if (discoverable) {
      clientRef.current?.setHello({ name: profile.name, device: detectDevice(), pfp: profile.pfp })
    } else {
      clientRef.current?.clearHello()
    }
  }, [profile, discoverable])

  const sendShareRequest = useCallback((peer: PeerInfo, metas: FileMeta[]) => {
    const reqId = crypto.randomUUID().slice(0, 8)
    const msg: PeerMsg = {
      t: 'share-req',
      reqId,
      total: metas.length,
      files: metas.slice(0, MAX_METAS_PER_REQUEST),
      name: profile.name,
      device: detectDevice(),
      pfp: profile.pfp,
    }
    clientRef.current?.sendTo(peer.id, msg)
    setOutgoing((prev) => [...prev, { reqId, toId: peer.id, toName: peer.name, status: 'waiting' }])
  }, [profile])

  const respondToShare = useCallback((req: IncomingRequest, accept: boolean) => {
    const msg: PeerMsg = { t: 'share-resp', reqId: req.reqId, accept }
    clientRef.current?.sendTo(req.from.id, msg)
    setIncoming(null)
  }, [])

  const clearOutgoing = useCallback((reqId: string) => {
    setOutgoing((prev) => prev.filter((o) => o.reqId !== reqId))
  }, [])

  return { connection, peers, incoming, outgoing, sendShareRequest, respondToShare, clearOutgoing }
}
