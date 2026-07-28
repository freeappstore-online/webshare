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

import { TransferDiag, storeReport } from './diagnostics'
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
/**
 * Every binary message carries where it belongs: [uint32 file][float64 offset].
 * That is what lets the channel be unordered — a chunk held up by a lost packet
 * no longer holds up the ones behind it, because none of them need to arrive in
 * any particular order to be written correctly.
 */
const HEADER = 12

/** How long to wait for the direct channel before calling it unreachable. */
const CONNECT_TIMEOUT_MS = 15_000
/**
 * How long the sender waits for the receiver to confirm it saved everything.
 * Generous: the receiver may still be flushing gigabytes to disk, or zipping,
 * long after the last byte arrived.
 */
const ACK_TIMEOUT_MS = 120_000

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
  /** Copy-pasteable timing/path report, once the transfer has settled. */
  onReport?(text: string): void
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
  private ackTimer: ReturnType<typeof setTimeout> | undefined
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

  // receiver-side write state. Chunks arrive unordered and can belong to
  // different files, so sinks are kept per index and completion is decided by
  // counting bytes against the manifest rather than by any message order.
  private sinks = new Map<number, FileSink>()
  private opening = new Map<number, Promise<FileSink | null>>()
  private received: number[] = []
  private manifest: ManifestEntry[] = []
  private sawAllBytes = false
  /**
   * Writes must happen strictly in order, but messages arrive faster than the
   * disk drains — chain every write onto a single promise queue.
   */
  private queue: Promise<void> = Promise.resolve()
  /** Chunks held back so the disk sees one big write instead of hundreds. */
  private pending: { index: number; offset: number; body: ArrayBuffer }[] = []
  private pendingBytes = 0
  private closed = new Set<number>()
  /**
   * Chunks that arrived before the manifest. Nothing orders the manifest ahead
   * of the data any more, so the first chunks can and do overtake it — they are
   * held here rather than dropped, and replayed once their sizes are known.
   */
  private early: ArrayBuffer[] = []
  private lastEmit = 0
  private readonly diag: TransferDiag
  private sawFirstByte = false

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
    this.diag = new TransferDiag(this.role)

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
    this.diag.mark('start')
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
      // unordered: see HEADER. Still fully reliable — SCTP only drops data if
      // maxRetransmits/maxPacketLifeTime are set, and they are not.
      const channel = pc.createDataChannel('files', { ordered: false })
      channel.binaryType = 'arraybuffer'
      this.bindChannel(channel)
      void (async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          this.diag.mark('offer-sent')
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
      this.diag.mark('channel-open')
      this.diag.noteChunk(this.chunkSize(), this.pc?.sctp?.maxMessageSize ?? 0)
      this.diag.startSampling(
        this.pc,
        () => this.stats.bytesDone,
        // sender: what's queued on the wire; receiver: what's not yet on disk
        () => (this.role === 'sender' ? (this.channel?.bufferedAmount ?? 0) : this.pendingBytes)
      )
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
      this.diag.mark('answer-sent')
      this.handlers.onSignal({ t: 'rtc-answer', reqId: this.reqId, sdp: answer.sdp ?? '' })
    } catch {
      this.fail(UNREACHABLE)
    }
  }

  async handleAnswer(sdp: string): Promise<void> {
    if (!this.pc) return
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp })
      this.diag.mark('answer-applied')
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

        const chunk = this.chunkSize()
        // Read in big blocks (a disk round trip per 16 KB would cost far more
        // than copying out of a loaded block) — but start the *next* read
        // before sending the current block, so the disk and the network work
        // at the same time. Reading and sending strictly in turn left the wire
        // idle for the whole of every read.
        const readAt = async (off: number) => {
          const t = performance.now()
          const buf = await file.slice(off, off + READ_BLOCK).arrayBuffer()
          this.diag.addReadTime(performance.now() - t)
          return buf
        }

        let inFlight: Promise<ArrayBuffer> | null = readAt(0)
        for (let off = 0; off < file.size; off += READ_BLOCK) {
          if (stale()) return
          const block = await inFlight!
          const next = off + READ_BLOCK
          inFlight = next < file.size ? readAt(next) : null

          for (let p = 0; p < block.byteLength; p += chunk) {
            if (stale()) return
            if (channel.bufferedAmount > HIGH_WATER) await this.drain(channel)
            if (stale()) return
            const end = Math.min(p + chunk, block.byteLength)
            const payload = new Uint8Array(HEADER + (end - p))
            const head = new DataView(payload.buffer)
            head.setUint32(0, i)
            head.setFloat64(4, off + p)
            payload.set(new Uint8Array(block, p, end - p), HEADER)
            channel.send(payload.buffer)
            if (!this.sawFirstByte) { this.sawFirstByte = true; this.diag.mark('first-byte') }
            this.stats.bytesDone += end - p
            this.emit()
          }
        }

        this.stats.filesDone++
        this.emit(true)
      }

      if (stale()) return
      channel.send(JSON.stringify({ t: 'done' }))
      // not finished yet — only the receiver can say the files actually landed
      this.diag.mark('done-sent')
      this.ackTimer = setTimeout(() => {
        this.fail("The other device never confirmed it saved the files.")
      }, ACK_TIMEOUT_MS)
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
      this.received = this.manifest.map(() => 0)
      this.stats.filesTotal = this.manifest.length
      this.stats.bytesTotal = Number(msg.bytes) || this.manifest.reduce((n, f) => n + f.s, 0)
      this.emit(true)
      // now that sizes are known, the chunks that beat the manifest can land
      const held = this.early
      this.early = []
      for (const chunk of held) void this.handleChunk(chunk)
      // an empty file never gets a chunk, so nothing else would ever create it
      for (let i = 0; i < this.manifest.length; i++) {
        if (this.manifest[i].s === 0) this.closeFile(i)
      }
      this.checkAllReceived()
    } else if (msg?.t === 'done') {
      // only says the sender has finished handing everything to the wire;
      // chunks may still be in flight, so completion waits on the byte count
      this.sawDone = true
      this.checkAllReceived()
    } else if (msg?.t === 'ack') {
      clearTimeout(this.ackTimer)
      this.complete()
    } else if (msg?.t === 'abort') {
      this.remoteAbort()
    }
  }

  private async handleChunk(buf: ArrayBuffer): Promise<void> {
    if (this.aborted || this.finished) return
    if (buf.byteLength < HEADER) return
    if (!this.sawFirstByte) { this.sawFirstByte = true; this.diag.mark('first-byte') }

    const head = new DataView(buf, 0, HEADER)
    const index = head.getUint32(0)
    const offset = head.getFloat64(4)
    // no manifest yet: hold on to it rather than dropping it on the floor
    if (!this.manifest.length) {
      // bounded, so a peer that never sends a manifest can't exhaust memory
      if (this.early.length < 256) this.early.push(buf)
      return
    }
    const entry = this.manifest[index]
    // a chunk for a file we have no manifest entry for is not writable
    if (!entry) return
    const body = buf.slice(HEADER)
    if (offset < 0 || offset + body.byteLength > entry.s) return

    // count on arrival: progress should track the transfer, not the disk
    this.stats.bytesDone += body.byteLength
    this.received[index] = (this.received[index] ?? 0) + body.byteLength
    this.emit()

    this.pending.push({ index, offset, body })
    this.pendingBytes += body.byteLength
    if (this.pendingBytes >= WRITE_BLOCK) this.flushPending()
    if (this.received[index] >= entry.s) this.closeFile(index)
  }

  /** Open (once) the sink for a file, creating it on first sight. */
  private sinkFor(index: number): Promise<FileSink | null> {
    let pending = this.opening.get(index)
    if (!pending) {
      const entry = this.manifest[index]
      pending = (async () => {
        if (!this.target || !entry) return null
        const sink = await this.target.create(entry.n, entry.s)
        this.sinks.set(index, sink)
        return sink
      })()
      this.opening.set(index, pending)
    }
    return pending
  }

  /** Write everything buffered so far, each piece at its own position. */
  private flushPending(): void {
    if (this.pendingBytes === 0) return
    const batch = this.pending
    this.pending = []
    this.pendingBytes = 0
    this.enqueue(async () => {
      if (this.aborted) return
      // group by file so each sink is resolved once per flush
      const byFile = new Map<number, typeof batch>()
      for (const part of batch) {
        const list = byFile.get(part.index)
        if (list) list.push(part)
        else byFile.set(part.index, [part])
      }
      for (const [index, parts] of byFile) {
        const sink = await this.sinkFor(index)
        if (!sink) continue
        // merge runs that happen to be contiguous, so the common in-order case
        // still costs one write per megabyte rather than one per chunk
        parts.sort((a, b) => a.offset - b.offset)
        let run: { offset: number; parts: ArrayBuffer[]; bytes: number } | null = null
        const flushRun = async () => {
          if (!run) return
          const merged = new Uint8Array(run.bytes)
          let at = 0
          for (const p of run.parts) {
            merged.set(new Uint8Array(p), at)
            at += p.byteLength
          }
          await sink.write(merged.buffer, run.offset)
          run = null
        }
        for (const p of parts) {
          if (run && run.offset + run.bytes === p.offset) {
            run.parts.push(p.body)
            run.bytes += p.body.byteLength
          } else {
            await flushRun()
            run = { offset: p.offset, parts: [p.body], bytes: p.body.byteLength }
          }
        }
        await flushRun()
      }
    })
  }

  /** A file has all its bytes — close it and see whether that was the last. */
  private closeFile(index: number): void {
    if (this.closed.has(index)) return
    this.closed.add(index)
    this.flushPending()
    this.enqueue(async () => {
      const sink = await this.sinkFor(index)
      await sink?.close()
      this.sinks.delete(index)
      this.stats.filesDone++
      this.emit(true)
    })
    this.checkAllReceived()
  }

  /**
   * Settle only when every file's bytes are accounted for. The sender's 'done'
   * can overtake chunks on an unordered channel, so it cannot itself be the
   * signal that the transfer is complete.
   */
  private checkAllReceived(): void {
    if (this.sawAllBytes || this.role !== 'receiver') return
    if (!this.manifest.length) return
    for (let i = 0; i < this.manifest.length; i++) {
      if ((this.received[i] ?? 0) < this.manifest[i].s) return
    }
    this.sawAllBytes = true
    this.flushPending()
    this.enqueue(async () => {
      await this.target?.finish()
      // tell the sender before we settle: this is what lets it report "Sent"
      // truthfully, and it must go out while the channel is still open
      try {
        this.channel?.send(JSON.stringify({ t: 'ack' }))
      } catch {
        /* channel already gone; the sender will time out and say so */
      }
      this.complete()
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
    clearTimeout(this.ackTimer)
    this.publishReport('completed')
    this.stats.currentName = null
    this.emit(true)
    this.handlers.onDone()
    // Give the last control message (the receiver's ack) time to leave before
    // the channel goes away. By this point all payload is accounted for, so
    // this is only about the handshake tail, not data.
    setTimeout(() => this.teardown(), 500)
  }

  private fail(message: string): void {
    if (this.finished || this.aborted) return
    this.aborted = true
    this.publishReport(`failed: ${message}`)
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
    this.publishReport('cancelled here')
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
    this.publishReport('cancelled by peer')
    this.cleanupPartial()
    this.teardown()
    this.handlers.onRemoteCancel()
  }

  private publishReport(outcome: string): void {
    this.diag.mark(outcome.startsWith('completed') ? 'done' : 'error')
    this.diag.stop()
    const text = this.diag.report(outcome, this.stats.bytesDone)
    storeReport(text)
    // always in the console too, so it survives the window being dismissed
    console.info(`[webshare]\n${text}`)
    this.handlers.onReport?.(text)
  }

  private cleanupPartial(): void {
    this.pending = []
    this.pendingBytes = 0
    for (const sink of this.sinks.values()) void sink.abort().catch(() => {})
    this.sinks.clear()
    this.opening.clear()
    this.target?.discard()
  }

  private teardown(): void {
    clearTimeout(this.connectTimer)
    clearTimeout(this.ackTimer)
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
