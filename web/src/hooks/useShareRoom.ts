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
export function useShareRoom(profile: Profile) {
  const [connection, setConnection] = useState<SignalState>('connecting')
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null)
  const [outgoing, setOutgoing] = useState<OutgoingRequest | null>(null)

  const clientRef = useRef<SignalClient | null>(null)
  const peersRef = useRef<PeerInfo[]>([])
  const outgoingRef = useRef<OutgoingRequest | null>(null)
  outgoingRef.current = outgoing

  useEffect(() => {
    const client = new SignalClient(signalUrl())
    clientRef.current = client

    client.onState = setConnection
    client.onPeers = (list) => {
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
      peersRef.current = sorted
      setPeers(sorted)
    }
    client.onMessage = (from, data) => {
      const m = data as PeerMsg
      if (m?.t === 'share-req') {
        const peer = peersRef.current.find((p) => p.id === from)
        setIncoming({
          from: peer ?? { id: from, name: 'Someone', device: 'desktop', pfp: null },
          reqId: m.reqId,
          total: m.total,
          files: m.files,
        })
      } else if (m?.t === 'share-resp') {
        const current = outgoingRef.current
        if (current?.reqId === m.reqId) {
          setOutgoing({ ...current, status: m.accept ? 'accepted' : 'declined' })
        }
      }
    }
    client.connect()

    return () => {
      client.close()
      clientRef.current = null
    }
  }, [])

  // announce identity now and on every profile change (re-sent on reconnects too)
  useEffect(() => {
    clientRef.current?.setHello({ name: profile.name, device: detectDevice(), pfp: profile.pfp })
  }, [profile])

  const sendShareRequest = useCallback((peer: PeerInfo, metas: FileMeta[]) => {
    const reqId = crypto.randomUUID().slice(0, 8)
    const msg: PeerMsg = {
      t: 'share-req',
      reqId,
      total: metas.length,
      files: metas.slice(0, MAX_METAS_PER_REQUEST),
    }
    clientRef.current?.sendTo(peer.id, msg)
    setOutgoing({ reqId, toId: peer.id, toName: peer.name, status: 'waiting' })
  }, [])

  const respondToShare = useCallback((req: IncomingRequest, accept: boolean) => {
    const msg: PeerMsg = { t: 'share-resp', reqId: req.reqId, accept }
    clientRef.current?.sendTo(req.from.id, msg)
    setIncoming(null)
  }, [])

  const clearOutgoing = useCallback(() => setOutgoing(null), [])

  return { connection, peers, incoming, outgoing, sendShareRequest, respondToShare, clearOutgoing }
}
