/**
 * File transfer, once a share request has been accepted.
 *
 * Bytes prefer a direct WebRTC data channel — on a LAN that's a straight
 * device-to-device link, so nothing touches a server. When no direct path can
 * be established (strict NAT, some corporate networks), the sender gives up
 * after `RTC_TIMEOUT_MS` and both sides fall back to relaying chunks through
 * the signaling worker, which is slower but always works.
 *
 * Wire (identical over both transports):
 *   sender → { t:'manifest', files:[{n,s}], bytes }   what's coming
 *   sender → { t:'file', i, n }  then binary chunks  then { t:'file-end', i }
 *   sender → { t:'done' }
 *   either → { t:'abort' }
 */

import type { SaveTarget, FileSink } from './saveTarget'

/** RTCDataChannel implementations cap a single message at 16 KiB in practice. */
const RTC_CHUNK = 16 * 1024
/** Relay chunks are base64'd (×4/3) into a 64 KB worker message budget. */
const RELAY_CHUNK = 32 * 1024
/** Pause reading while this many bytes are still queued on the wire. */
const HIGH_WATER = 4 * 1024 * 1024
const LOW_WATER = 512 * 1024
/** How long the sender keeps trying for a direct connection before relaying. */
const RTC_TIMEOUT_MS = 8000
/**
 * How long the receiver waits for the first byte before asking the sender to
 * relay. Longer than RTC_TIMEOUT_MS so the sender's own fallback goes first.
 */
const RECV_TIMEOUT_MS = 13_000
/** And how long after that before we admit the peer is simply unreachable. */
const STALL_TIMEOUT_MS = 15_000

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

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
  onRelayed(): void
  onDone(): void
  onError(message: string): void
  /** Remote side aborted — distinct from an error so the UI can say so. */
  onRemoteCancel(): void
}

// --- transports -------------------------------------------------------------

interface Wire {
  send(data: string | ArrayBuffer): void
  readonly buffered: number
  /** Resolves once the wire has drained below LOW_WATER. */
  drain(): Promise<void>
  close(): void
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  // chunked so a big buffer doesn't blow the argument limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(s)
}

function fromBase64(s: string): ArrayBuffer {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

// --- the transfer itself ----------------------------------------------------

export class Transfer {
  readonly reqId: string
  readonly role: 'sender' | 'receiver'

  private readonly handlers: TransferHandlers
  private readonly files: File[]
  private readonly target: SaveTarget | null
  /** Relay transport: pushes an `xfer-data` payload through the worker. */
  private readonly relaySend: (payload: { c?: unknown; b?: string }) => void
  private readonly relayBuffered: () => number

  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private wire: Wire | null = null
  private relayed = false
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined
  private recvTimer: ReturnType<typeof setTimeout> | undefined
  /** Receiver: has anything at all arrived from the sender yet? */
  private heardFromPeer = false
  /** Lets a restart-over-relay past the "no transport swap mid-flight" guard. */
  private forceRelay = false
  /** Bumped on restart so an older pump loop stops instead of interleaving. */
  private generation = 0
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
    relaySend: (payload: { c?: unknown; b?: string }) => void
    relayBuffered: () => number
    handlers: TransferHandlers
  }) {
    this.reqId = opts.reqId
    this.role = opts.role
    this.files = opts.files ?? []
    this.target = opts.target ?? null
    this.relaySend = opts.relaySend
    this.relayBuffered = opts.relayBuffered
    this.handlers = opts.handlers

    if (this.role === 'sender') {
      const real = this.sendableFiles()
      this.stats.filesTotal = real.length
      this.stats.bytesTotal = real.reduce((n, f) => n + f.size, 0)
    }
  }

  /** Folder placeholders are icons in the staging list, not real payloads. */
  private sendableFiles(): File[] {
    return this.files.filter((f) => f.type !== 'application/x-directory')
  }

  get progress(): TransferStats {
    return this.stats
  }

  get isRelayed(): boolean {
    return this.relayed
  }

  // --- setup ---------------------------------------------------------------

  start(): void {
    this.openRtc()
    if (this.role === 'receiver') this.armReceiveWatchdog()
  }

  /**
   * The receiver can't tell the difference between "still negotiating" and
   * "this is never going to connect", and the sender's own fallback only
   * covers *its* view of the channel — a half-open path leaves this side
   * waiting forever. So: if nothing has arrived in time, ask the sender to
   * relay, and if that produces nothing either, say so instead of spinning.
   */
  private armReceiveWatchdog(): void {
    this.recvTimer = setTimeout(() => {
      if (this.heardFromPeer || this.finished || this.aborted) return
      if (!this.relayed) {
        this.handlers.onSignal({ t: 'xfer-relay', reqId: this.reqId })
        this.switchToRelay(false)
      }
      this.recvTimer = setTimeout(() => {
        if (this.heardFromPeer || this.finished || this.aborted) return
        this.fail("Couldn't reach the sender — ask them to try again")
      }, STALL_TIMEOUT_MS)
    }, RECV_TIMEOUT_MS)
  }

  private openRtc(): void {
    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    } catch {
      // no WebRTC at all (old browser, hardened config) — relay straight away
      if (this.role === 'sender') this.switchToRelay(true)
      return
    }
    this.pc = pc

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.handlers.onSignal({ t: 'rtc-ice', reqId: this.reqId, candidate: ev.candidate.toJSON() })
      }
    }
    pc.onconnectionstatechange = () => {
      // 'failed' means ICE exhausted every path — don't wait out the timer
      if (pc.connectionState === 'failed' && this.role === 'sender' && !this.relayed) {
        this.switchToRelay(true)
      }
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
          this.switchToRelay(true)
        }
      })()
      // if nothing is flowing by now, a direct link isn't happening
      this.fallbackTimer = setTimeout(() => {
        if (!this.relayed && this.channel?.readyState !== 'open') this.switchToRelay(true)
      }, RTC_TIMEOUT_MS)
    } else {
      pc.ondatachannel = (ev) => {
        ev.channel.binaryType = 'arraybuffer'
        this.bindChannel(ev.channel)
      }
    }
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel
    channel.bufferedAmountLowThreshold = LOW_WATER
    const onOpen = () => {
      if (this.relayed) return
      clearTimeout(this.fallbackTimer)
      this.wire = {
        send: (data) => {
          if (typeof data === 'string') channel.send(data)
          else channel.send(data)
        },
        get buffered() {
          return channel.bufferedAmount
        },
        drain: () =>
          new Promise<void>((resolve) => {
            const onLow = () => {
              channel.removeEventListener('bufferedamountlow', onLow)
              resolve()
            }
            channel.addEventListener('bufferedamountlow', onLow)
          }),
        close: () => channel.close(),
      }
      this.onWireOpen()
    }
    // Chrome hands the receiver a channel that is *already* open, so a plain
    // `onopen` handler would never fire and this side would sit there with no
    // wire — check the state instead of trusting the event.
    if (channel.readyState === 'open') onOpen()
    else channel.onopen = onOpen
    channel.onmessage = (ev) => {
      if (this.relayed) return
      if (typeof ev.data === 'string') this.handleControl(JSON.parse(ev.data))
      else void this.handleChunk(ev.data as ArrayBuffer)
    }
    channel.onclose = () => {
      // a close before 'done' means the peer vanished mid-transfer
      if (!this.finished && !this.aborted && !this.relayed && !this.sawDone) {
        this.fail('Connection lost')
      }
    }
  }

  /** Have any payload bytes crossed the wire yet? */
  private get inFlight(): boolean {
    return this.stats.bytesDone > 0
  }

  /**
   * Give up on WebRTC; `announce` tells the peer to switch too.
   *
   * Only valid before any bytes have moved. Swapping transports mid-file would
   * silently drop whatever was still buffered in the dead data channel and the
   * receiver would write a corrupt file, so once we're streaming, a broken
   * connection is a failure — not something to paper over.
   */
  private switchToRelay(announce: boolean): void {
    if (this.relayed || this.finished || this.aborted) return
    if (this.inFlight && !this.forceRelay) {
      this.fail('Connection lost')
      return
    }
    this.forceRelay = false
    this.relayed = true
    clearTimeout(this.fallbackTimer)
    this.channel?.close()
    this.channel = null
    this.pc?.close()
    this.pc = null
    if (announce) this.handlers.onSignal({ t: 'xfer-relay', reqId: this.reqId })

    const relayBuffered = this.relayBuffered
    this.wire = {
      send: (data) => {
        if (typeof data === 'string') this.relaySend({ c: JSON.parse(data) })
        else this.relaySend({ b: toBase64(data) })
      },
      get buffered() {
        return relayBuffered()
      },
      // the WebSocket has no drain event — poll until it works the backlog off
      drain: () =>
        new Promise<void>((resolve) => {
          const tick = () => (relayBuffered() <= LOW_WATER ? resolve() : setTimeout(tick, 50))
          tick()
        }),
      close: () => {},
    }

    this.handlers.onRelayed()
    this.onWireOpen()
  }

  /**
   * Peer told us it fell back to the relay.
   *
   * A receiver only sends this when it has received *nothing*, so if we'd
   * already started pushing bytes into a channel it never heard from, the safe
   * move is to rewind and send the whole thing again over the relay — not to
   * refuse (as a mid-flight transport swap normally must).
   */
  acceptRelay(): void {
    if (this.relayed || this.finished || this.aborted) return
    if (this.role === 'sender' && this.inFlight) {
      this.generation++
      this.stats.bytesDone = 0
      this.stats.filesDone = 0
      this.stats.currentName = null
      this.emit()
    }
    this.relayed = false
    this.forceRelay = true
    this.switchToRelay(false)
  }

  private onWireOpen(): void {
    if (this.role === 'sender') void this.pump()
  }

  // --- signaling from the peer ---------------------------------------------

  async handleOffer(sdp: string): Promise<void> {
    if (!this.pc || this.relayed) return
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp })
      await this.flushIce()
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.handlers.onSignal({ t: 'rtc-answer', reqId: this.reqId, sdp: answer.sdp ?? '' })
    } catch {
      // the sender's timeout will move us both to the relay
    }
  }

  async handleAnswer(sdp: string): Promise<void> {
    if (!this.pc || this.relayed) return
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp })
      await this.flushIce()
    } catch {
      /* same — fall back on timeout */
    }
  }

  async handleIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || this.relayed) return
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

  /** A relayed `xfer-data` payload arrived through the worker. */
  handleRelayData(payload: { c?: unknown; b?: string }): void {
    // data over the relay means the peer already switched; follow it even if
    // we'd otherwise refuse (we've received nothing, so there's nothing to lose)
    if (!this.relayed) {
      this.forceRelay = true
      this.switchToRelay(false)
    }
    if (payload.c !== undefined) this.handleControl(payload.c)
    else if (typeof payload.b === 'string') void this.handleChunk(fromBase64(payload.b))
  }

  // --- sending -------------------------------------------------------------

  private async pump(): Promise<void> {
    const wire = this.wire
    if (!wire) return
    // a restart bumps the generation; the superseded loop bails out rather
    // than interleaving its chunks with the new one's
    const gen = this.generation
    const stale = () => this.aborted || gen !== this.generation
    const files = this.sendableFiles()
    try {
      wire.send(
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
        this.emit()
        wire.send(JSON.stringify({ t: 'file', i, n: file.name }))

        // fixed for the whole file — the transport can't change once we're
        // streaming (a restart replaces this loop outright), so it's stable
        const chunk = this.chunkSize()
        for (let off = 0; off < file.size; off += chunk) {
          if (stale()) return
          if (wire.buffered > HIGH_WATER) await wire.drain()
          if (stale()) return
          const buf = await file.slice(off, off + chunk).arrayBuffer()
          if (stale()) return
          wire.send(buf)
          this.stats.bytesDone += buf.byteLength
          this.emit()
        }

        wire.send(JSON.stringify({ t: 'file-end', i }))
        this.stats.filesDone++
        this.emit()
      }

      if (stale()) return
      wire.send(JSON.stringify({ t: 'done' }))
      this.complete()
    } catch (err) {
      if (!stale()) this.fail(err instanceof Error ? err.message : 'Transfer failed')
    }
  }

  private chunkSize(): number {
    return this.relayed ? RELAY_CHUNK : RTC_CHUNK
  }

  // --- receiving -----------------------------------------------------------

  private handleControl(raw: unknown): void {
    // messages already in flight when we cancelled must not restart anything —
    // a late 'done' would otherwise hand the user their half-received files
    if (this.aborted || this.finished) return
    this.heardFromPeer = true
    clearTimeout(this.recvTimer)
    const msg = raw as { t?: string; files?: ManifestEntry[]; bytes?: number; n?: string }
    if (msg?.t === 'manifest') {
      this.manifest = Array.isArray(msg.files) ? msg.files : []
      this.stats.filesTotal = this.manifest.length
      this.stats.bytesTotal = Number(msg.bytes) || this.manifest.reduce((n, f) => n + f.s, 0)
      this.emit()
    } else if (msg?.t === 'file') {
      const name = typeof msg.n === 'string' ? msg.n : 'file'
      this.stats.currentName = name
      this.emit()
      // serialize opening against the chunk queue below
      this.enqueue(async () => {
        this.sink = this.target ? await this.target.create(name) : null
      })
    } else if (msg?.t === 'file-end') {
      this.enqueue(async () => {
        await this.sink?.close()
        this.sink = null
        this.stats.filesDone++
        this.emit()
      })
    } else if (msg?.t === 'done') {
      this.sawDone = true
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
    this.enqueue(async () => {
      if (this.aborted) return
      await this.sink?.write(buf)
      this.stats.bytesDone += buf.byteLength
      this.emit()
    })
  }

  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch((err) => {
      if (!this.aborted) this.fail(err instanceof Error ? err.message : 'Could not save the file')
    })
  }

  // --- teardown ------------------------------------------------------------

  private emit(): void {
    this.handlers.onProgress({ ...this.stats })
  }

  private complete(): void {
    if (this.finished || this.aborted) return
    this.finished = true
    clearTimeout(this.fallbackTimer)
    this.stats.currentName = null
    this.emit()
    this.handlers.onDone()

    if (this.role !== 'sender') {
      this.teardown()
      return
    }
    // Closing the channel with bytes still queued would strand the receiver's
    // final chunks, so hold it open until the wire drains (or we give up).
    const deadline = Date.now() + 15_000
    const waitDrain = () => {
      if ((this.wire?.buffered ?? 0) > 0 && Date.now() < deadline) {
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
      this.wire?.send(JSON.stringify({ t: 'abort' }))
    } catch {
      /* wire already gone */
    }
    this.handlers.onSignal({ t: 'xfer-abort', reqId: this.reqId })
    this.cleanupPartial()
    this.teardown()
  }

  /** Peer cancelled. */
  remoteAbort(): void {
    if (this.finished || this.aborted) return
    this.aborted = true
    this.cleanupPartial()
    this.teardown()
    this.handlers.onRemoteCancel()
  }

  private cleanupPartial(): void {
    const sink = this.sink
    this.sink = null
    void sink?.abort().catch(() => {})
    this.target?.discard()
  }

  private teardown(): void {
    clearTimeout(this.fallbackTimer)
    clearTimeout(this.recvTimer)
    this.wire?.close()
    this.wire = null
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
