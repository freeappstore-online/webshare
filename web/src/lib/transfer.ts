/**
 * File transfer, once a share request has been accepted.
 *
 * Bytes only ever travel over a direct WebRTC data channel between the two
 * devices. There is deliberately no server-side relay and no STUN/TURN: on a
 * shared network the peers reach each other with host (or mDNS) candidates
 * alone, so nothing about the transfer — not the data, not even the IP
 * discovery — involves a third party. The signaling worker trades the
 * handshake and nothing else; it never sees a byte of a file.
 *
 * The cost of that is honest: if no direct path exists (the two devices are on
 * different networks, or the access point isolates its clients) the transfer
 * fails and says so, rather than quietly routing the files through a server.
 *
 * Wire:
 *   sender → { t:'manifest', files:[{n,s}], bytes }   what's coming
 *   sender → { t:'file', i, n }  then binary chunks  then { t:'file-end', i }
 *   sender → { t:'done' }
 *   either → { t:'abort' }
 */

import type { SaveTarget, FileSink } from './saveTarget'

/** Safe floor for a single data-channel message across implementations. */
const RTC_CHUNK = 16 * 1024
/** Ceiling once SCTP tells us it can take more — fewer, bigger messages. */
const MAX_RTC_CHUNK = 64 * 1024
/** Pull this much off disk at a time, then hand it out in wire-sized pieces. */
const READ_BLOCK = 4 * 1024 * 1024
/** Coalesce received chunks to about this much before touching the disk. */
const WRITE_BLOCK = 1024 * 1024
/**
 * Progress goes into React state, so emitting per chunk means a full re-render
 * per chunk — which throttles the transfer far below the network's capacity.
 * Ten updates a second is smooth to the eye and costs nothing.
 */
const PROGRESS_INTERVAL_MS = 100
/** Pause reading while this many bytes are still queued on the wire. */
const HIGH_WATER = 4 * 1024 * 1024
const LOW_WATER = 512 * 1024
/** How long to wait for the direct channel before calling it unreachable. */
const CONNECT_TIMEOUT_MS = 15_000

/**
 * Empty on purpose. A STUN server's job is to discover your *public* address
 * for NAT traversal, which is irrelevant between two devices on one network —
 * and asking a third party for it would leak the user's IP on every transfer.
 */
const ICE_SERVERS: RTCIceServer[] = []

const UNREACHABLE =
  "Couldn't reach that device directly. You both need to be on the same network — " +
  'Webshare never routes files through a server.'

interface ManifestEntry {
  n: string
  s: number
}

export interface TransferStats {
  bytesDone: number
  bytesTotal: number
  filesDone: number
  filesTotal: number
  currentName: string | null
}

/** Callbacks the hook wires up to React state. */
export interface TransferHandlers {
  onSignal(msg: unknown): void
  onProgress(stats: TransferStats): void
  onDone(): void
  onError(message: string): void
  /** Remote side aborted — distinct from an error so the UI can say so. */
  onRemoteCancel(): void
}

export class Transfer {
  readonly reqId: string
  readonly role: 'sender' | 'receiver'

  private readonly handlers: TransferHandlers
  private readonly files: File[]
  private readonly target: SaveTarget | null

  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private connectTimer: ReturnType<typeof setTimeout> | undefined
  /** ICE candidates that arrived before the remote description was applied. */
  private pendingIce: RTCIceCandidateInit[] = []
  private finished = false
  private aborted = false
  /**
   * Set the instant the sender's `done` arrives, before the write queue has
   * drained. Without it, the sender closing its channel while we're still
   * flushing the last chunks to disk would look like a dropped connection.
   */
  private sawDone = false

  // receiver-side write state
  private sink: FileSink | null = null
  private manifest: ManifestEntry[] = []
  /**
   * Writes must happen strictly in order, but messages arrive faster than the
   * disk drains — chain every write onto a single promise queue.
   */
  private queue: Promise<void> = Promise.resolve()
  /** Chunks held back so the disk sees one big write instead of hundreds. */
  private pending: ArrayBuffer[] = []
  private pendingBytes = 0
  private lastEmit = 0

  private stats: TransferStats = {
    bytesDone: 0,
    bytesTotal: 0,
    filesDone: 0,
    filesTotal: 0,
    currentName: null,
  }

  constructor(opts: {
    reqId: string
    role: 'sender' | 'receiver'
    files?: File[]
    target?: SaveTarget | null
    handlers: TransferHandlers
  }) {
    this.reqId = opts.reqId
    this.role = opts.role
    this.files = opts.files ?? []
    this.target = opts.target ?? null
    this.handlers = opts.handlers

    if (this.role === 'sender') {
      this.stats.filesTotal = this.files.length
      this.stats.bytesTotal = this.files.reduce((n, f) => n + f.size, 0)
    }
  }

  get progress(): TransferStats {
    return this.stats
  }

  // --- setup ---------------------------------------------------------------

  start(): void {
    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    } catch {
      this.fail('This browser can’t open a direct connection.')
      return
    }
    this.pc = pc

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.handlers.onSignal({ t: 'rtc-ice', reqId: this.reqId, candidate: ev.candidate.toJSON() })
      }
    }
    pc.onconnectionstatechange = () => {
      // ICE exhausted every path — no point waiting out the timer
      if (pc.connectionState === 'failed') this.fail(UNREACHABLE)
    }

    if (this.role === 'sender') {
      const channel = pc.createDataChannel('files', { ordered: true })
      channel.binaryType = 'arraybuffer'
      this.bindChannel(channel)
      void (async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          this.handlers.onSignal({ t: 'rtc-offer', reqId: this.reqId, sdp: offer.sdp ?? '' })
        } catch {
          this.fail(UNREACHABLE)
        }
      })()
    } else {
      pc.ondatachannel = (ev) => {
        ev.channel.binaryType = 'arraybuffer'
        this.bindChannel(ev.channel)
      }
    }

    this.connectTimer = setTimeout(() => {
      if (this.channel?.readyState !== 'open') this.fail(UNREACHABLE)
    }, CONNECT_TIMEOUT_MS)
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel
    channel.bufferedAmountLowThreshold = LOW_WATER

    const onOpen = () => {
      clearTimeout(this.connectTimer)
      if (this.role === 'sender') void this.pump()
    }
    // Chrome hands the receiver a channel that is *already* open, so a plain
    // `onopen` handler would never fire and this side would sit there idle.
    if (channel.readyState === 'open') onOpen()
    else channel.onopen = onOpen

    channel.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.handleControl(JSON.parse(ev.data))
      else void this.handleChunk(ev.data as ArrayBuffer)
    }
    channel.onclose = () => {
      // a close before 'done' means the peer vanished mid-transfer
      if (!this.finished && !this.aborted && !this.sawDone) this.fail('Connection lost')
    }
  }

  // --- signaling from the peer ---------------------------------------------

  async handleOffer(sdp: string): Promise<void> {
    if (!this.pc) return
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp })
      await this.flushIce()
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.handlers.onSignal({ t: 'rtc-answer', reqId: this.reqId, sdp: answer.sdp ?? '' })
    } catch {
      this.fail(UNREACHABLE)
    }
  }

  async handleAnswer(sdp: string): Promise<void> {
    if (!this.pc) return
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp })
      await this.flushIce()
    } catch {
      this.fail(UNREACHABLE)
    }
  }

  async handleIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return
    if (!this.pc.remoteDescription) {
      this.pendingIce.push(candidate)
      return
    }
    await this.pc.addIceCandidate(candidate).catch(() => {})
  }

  private async flushIce(): Promise<void> {
    const queued = this.pendingIce
    this.pendingIce = []
    for (const c of queued) await this.pc?.addIceCandidate(c).catch(() => {})
  }

  // --- sending -------------------------------------------------------------

  private chunkSize(): number {
    // browsers report what SCTP negotiated (Chrome: 256 KB); 16 KB is only the
    // universally-safe floor, and using it needlessly quadruples message count
    const max = this.pc?.sctp?.maxMessageSize ?? 0
    return max > RTC_CHUNK ? Math.min(max, MAX_RTC_CHUNK) : RTC_CHUNK
  }

  /** Resolves once the channel has worked its backlog off. */
  private drain(channel: RTCDataChannel): Promise<void> {
    return new Promise<void>((resolve) => {
      const onLow = () => {
        channel.removeEventListener('bufferedamountlow', onLow)
        resolve()
      }
      channel.addEventListener('bufferedamountlow', onLow)
    })
  }

  private async pump(): Promise<void> {
    const channel = this.channel
    if (!channel) return
    const stale = () => this.aborted || this.finished
    const files = this.files
    try {
      channel.send(
        JSON.stringify({
          t: 'manifest',
          files: files.map((f) => ({ n: f.name, s: f.size })),
          bytes: this.stats.bytesTotal,
        })
      )

      for (let i = 0; i < files.length; i++) {
        if (stale()) return
        const file = files[i]
        this.stats.currentName = file.name
        this.emit(true)
        channel.send(JSON.stringify({ t: 'file', i, n: file.name }))

        const chunk = this.chunkSize()
        // read in big blocks, send in wire-sized pieces — a disk round trip per
        // 16 KB costs far more than the copy out of an already-loaded block
        for (let off = 0; off < file.size; off += READ_BLOCK) {
          if (stale()) return
          const block = await file.slice(off, off + READ_BLOCK).arrayBuffer()
          for (let p = 0; p < block.byteLength; p += chunk) {
            if (stale()) return
            if (channel.bufferedAmount > HIGH_WATER) await this.drain(channel)
            if (stale()) return
            const end = Math.min(p + chunk, block.byteLength)
            channel.send(block.slice(p, end))
            this.stats.bytesDone += end - p
            this.emit()
          }
        }

        channel.send(JSON.stringify({ t: 'file-end', i }))
        this.stats.filesDone++
        this.emit(true)
      }

      if (stale()) return
      channel.send(JSON.stringify({ t: 'done' }))
      this.complete()
    } catch (err) {
      if (!stale()) this.fail(err instanceof Error ? err.message : 'Transfer failed')
    }
  }

  // --- receiving -----------------------------------------------------------

  private handleControl(raw: unknown): void {
    // messages already in flight when we cancelled must not restart anything —
    // a late 'done' would otherwise hand the user their half-received files
    if (this.aborted || this.finished) return
    const msg = raw as { t?: string; files?: ManifestEntry[]; bytes?: number; n?: string }
    if (msg?.t === 'manifest') {
      this.manifest = Array.isArray(msg.files) ? msg.files : []
      this.stats.filesTotal = this.manifest.length
      this.stats.bytesTotal = Number(msg.bytes) || this.manifest.reduce((n, f) => n + f.s, 0)
      this.emit(true)
    } else if (msg?.t === 'file') {
      const name = typeof msg.n === 'string' ? msg.n : 'file'
      this.stats.currentName = name
      this.emit(true)
      // serialize opening against the chunk queue below
      this.enqueue(async () => {
        this.sink = this.target ? await this.target.create(name) : null
      })
    } else if (msg?.t === 'file-end') {
      this.flushPending()
      this.enqueue(async () => {
        await this.sink?.close()
        this.sink = null
        this.stats.filesDone++
        this.emit(true)
      })
    } else if (msg?.t === 'done') {
      this.sawDone = true
      this.flushPending()
      this.enqueue(async () => {
        await this.target?.finish()
        this.complete()
      })
    } else if (msg?.t === 'abort') {
      this.remoteAbort()
    }
  }

  private async handleChunk(buf: ArrayBuffer): Promise<void> {
    if (this.aborted || this.finished) return
    // count on arrival: progress should track the transfer, not the disk
    this.stats.bytesDone += buf.byteLength
    this.emit()
    this.pending.push(buf)
    this.pendingBytes += buf.byteLength
    if (this.pendingBytes >= WRITE_BLOCK) this.flushPending()
  }

  /** Hand everything buffered so far to the sink as a single write. */
  private flushPending(): void {
    if (this.pendingBytes === 0) return
    const batch = this.pending
    const total = this.pendingBytes
    this.pending = []
    this.pendingBytes = 0
    this.enqueue(async () => {
      if (this.aborted) return
      const merged = new Uint8Array(total)
      let at = 0
      for (const part of batch) {
        merged.set(new Uint8Array(part), at)
        at += part.byteLength
      }
      await this.sink?.write(merged.buffer)
    })
  }

  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch((err) => {
      if (!this.aborted) this.fail(err instanceof Error ? err.message : 'Could not save the file')
    })
  }

  // --- teardown ------------------------------------------------------------

  /** `force` for state changes and the final update, which must never be lost. */
  private emit(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < PROGRESS_INTERVAL_MS) return
    this.lastEmit = now
    this.handlers.onProgress({ ...this.stats })
  }

  private complete(): void {
    if (this.finished || this.aborted) return
    this.finished = true
    clearTimeout(this.connectTimer)
    this.stats.currentName = null
    this.emit(true)
    this.handlers.onDone()

    if (this.role !== 'sender') {
      this.teardown()
      return
    }
    // Closing the channel with bytes still queued would strand the receiver's
    // final chunks, so hold it open until the wire drains (or we give up).
    const deadline = Date.now() + 15_000
    const waitDrain = () => {
      if ((this.channel?.bufferedAmount ?? 0) > 0 && Date.now() < deadline) {
        setTimeout(waitDrain, 100)
        return
      }
      this.teardown()
    }
    setTimeout(waitDrain, 100)
  }

  private fail(message: string): void {
    if (this.finished || this.aborted) return
    this.aborted = true
    this.cleanupPartial()
    this.teardown()
    this.handlers.onError(message)
  }

  /** Local cancel — tell the peer, then stop. */
  cancel(): void {
    if (this.finished || this.aborted) return
    this.aborted = true
    try {
      this.channel?.send(JSON.stringify({ t: 'abort' }))
    } catch {
      /* channel already gone */
    }
    this.handlers.onSignal({ t: 'xfer-abort', reqId: this.reqId })
    this.cleanupPartial()
    this.teardown()
  }

  /**
   * Peer cancelled.
   *
   * This can land *after* we've marked ourselves done: the sender pushes its
   * last byte long before the receiver has finished writing, so "done" on the
   * sending side only ever meant "sent", not "received". A receiver only sends
   * abort when it did not complete, so their cancel is the true outcome and has
   * to override our optimistic finish.
   */
  remoteAbort(): void {
    if (this.aborted) return
    this.finished = false
    this.aborted = true
    this.cleanupPartial()
    this.teardown()
    this.handlers.onRemoteCancel()
  }

  private cleanupPartial(): void {
    this.pending = []
    this.pendingBytes = 0
    const sink = this.sink
    this.sink = null
    void sink?.abort().catch(() => {})
    this.target?.discard()
  }

  private teardown(): void {
    clearTimeout(this.connectTimer)
    this.channel?.close()
    this.channel = null
    this.pc?.close()
    this.pc = null
  }

  /** Component unmount / room teardown — stop without notifying anyone. */
  dispose(): void {
    this.aborted = true
    this.cleanupPartial()
    this.teardown()
  }
}
