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
}

export interface OutgoingRequest {
  reqId: string
  toId: string
  toName: string
  status: 'waiting' | 'accepted' | 'declined'
}

/** Peer-to-peer payloads relayed through the signaling server. */
export type PeerMsg =
  | { t: 'share-req'; reqId: string; total: number; files: FileMeta[]; name: string; device: DeviceKind; pfp: string | null }
  | { t: 'share-resp'; reqId: string; accept: boolean }
