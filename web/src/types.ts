/** Saved in localStorage — identity is per-device, AirDrop style. No accounts. */
export interface Profile {
  name: string
  pfp: string | null
}

export type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'watch'

export type FileKind = 'image' | 'video' | 'audio' | 'doc' | 'archive' | 'folder' | 'other'

/** Compact file metadata sent in share requests. */
export interface FileMeta {
  /** name (truncated) */
  n: string
  /** size in bytes */
  s: number
  /** kind */
  k: FileKind
}

/** Someone else on your network with webshare open (from the server roster). */
export interface PeerInfo {
  id: string
  name: string
  device: DeviceKind
  pfp: string | null
}

export interface IncomingRequest {
  from: PeerInfo
  reqId: string
  /** true file count — `files` may be capped for very large batches */
  total: number
  files: FileMeta[]
  withdrawn?: boolean
}

export interface OutgoingRequest {
  reqId: string
  toId: string
  toName: string
  status: 'waiting' | 'accepted' | 'declined' | 'withdrawn'
}

/** Peer-to-peer payloads relayed through the signaling server. */
export type PeerMsg =
  | { t: 'share-req'; reqId: string; total: number; files: FileMeta[]; name: string; device: DeviceKind; pfp: string | null }
  | { t: 'share-resp'; reqId: string; accept: boolean }
  | { t: 'share-cancel'; reqId: string }
  // --- transfer setup: only the handshake goes through the worker, never data ---
  // `link` indexes one of several parallel connections; each carries its own
  // congestion window, which is the only way past cwnd/RTT on a lossy link
  | { t: 'rtc-offer'; reqId: string; link: number; sdp: string }
  | { t: 'rtc-answer'; reqId: string; link: number; sdp: string }
  | { t: 'rtc-ice'; reqId: string; link: number; candidate: RTCIceCandidateInit }
  /** Either side aborted mid-transfer. */
  | { t: 'xfer-abort'; reqId: string }

export type TransferState = 'connecting' | 'transferring' | 'done' | 'cancelled' | 'error'

/** Live state of one in-flight transfer, rendered as a progress window. */
export interface TransferProgress {
  reqId: string
  dir: 'send' | 'recv'
  /** Which peer this is with — matches PeerInfo.id, so the share page can
   *  draw the ring on the right avatar. */
  peerId: string
  peerName: string
  peerPfp: string | null
  state: TransferState
  bytesDone: number
  bytesTotal: number
  filesDone: number
  filesTotal: number
  currentName: string | null
  /** where the files landed — shown on completion (receiver only) */
  savedTo: string | null
  error: string | null
  /** copy-pasteable timing/path report, filled in once the transfer settles */
  report: string | null
  startedAt: number
}
