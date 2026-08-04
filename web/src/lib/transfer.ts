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

import { crc32 } from './crc32'
import { DIAGNOSTICS, TransferDiag, storeReport } from './diagnostics'
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
/**
 * How much to keep queued on a link, as time rather than bytes.
 *
 * A fixed byte budget is wrong at both ends of the range. The 4 MB this used to
 * hold is a fifth of a second on a fast link and eight seconds on a slow one —
 * and eight seconds of data in a queue nothing can drain is the sender causing
 * its own bufferbloat: round-trip time climbs into seconds, the delay triggers
 * loss, and the window collapses. That was visible as a transfer starting at a
 * normal speed, stalling hard for ten seconds with RTT at 4.8 s, then settling
 * once the queue finally drained.
 *
 * Half a second is enough to keep the link busy across a scheduling hiccup
 * without building a queue anyone waits on.
 */
const QUEUE_SECONDS = 0.5
/** Cap on chunks held while waiting for a manifest that should already be here. */
const MAX_EARLY_BYTES = 32 * 1024 * 1024
const MIN_QUEUE = 256 * 1024
const MAX_QUEUE = 4 * 1024 * 1024
const LOW_WATER = 128 * 1024
/**
 * Every binary message carries where it belongs: [uint32 file][float64 offset].
 * That is what lets the channel be unordered — a chunk held up by a lost packet
 * no longer holds up the ones behind it, because none of them need to arrive in
 * any particular order to be written correctly.
 */
const HEADER = 12

/**
 * How many parallel peer connections carry the file.
 *
 * Two, not more, and measured rather than guessed. The theory for going wide
 * was that throughput is the congestion window over the round-trip time, so
 * several windows would add up. Two runs over the same link disagree: the
 * window doubled (87 KB at 169 ms, then 204 KB at 433 ms) while throughput
 * stayed at roughly 0.5 MB/s. A window that grows without moving throughput
 * means the medium is rate-capped, and no number of windows raises a rate cap.
 *
 * Four links also made the link measurably worse — median round-trip 169 ms to
 * 433 ms, worst case 0.6 s to 6.4 s — which is what contention for airtime on
 * one half-duplex radio looks like. Two keeps the one thing parallelism does
 * buy, that a link stalling doesn't halt everything, at half the contention.
 */
const LINKS = 2
/** How long to wait for the direct channel before calling it unreachable. */
const CONNECT_TIMEOUT_MS = 15_000
/** After the first link is up, how long to let the rest join before starting. */
const LINK_GATHER_MS = 2500
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

/** One of the parallel connections carrying the file. */
interface Link {
  index: number
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  /** ICE candidates that arrived before the remote description was applied. */
  pendingIce: RTCIceCandidateInit[]
}

export class Transfer {
  readonly reqId: string
  readonly role: 'sender' | 'receiver'

  private readonly handlers: TransferHandlers
  private readonly files: File[]
  private readonly target: SaveTarget | null

  private links: Link[] = []
  private connectTimer: ReturnType<typeof setTimeout> | undefined
  private ackTimer: ReturnType<typeof setTimeout> | undefined
  private gatherTimer: ReturnType<typeof setTimeout> | undefined
  private pumping = false
  private pumpStartedAt = 0
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
  /** CRC32 per file as the sender read it; empty until the sums arrive. */
  private expectedSums: number[] = []
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
  private earlyBytes = 0
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
    if (this.role === 'sender') {
      for (let i = 0; i < LINKS; i++) this.openLink(i)
    }
    // the receiver builds its side as offers arrive, one per link
    this.connectTimer = setTimeout(() => {
      if (!this.openChannels().length) this.fail(UNREACHABLE)
    }, CONNECT_TIMEOUT_MS)
  }

  /** Create (or fetch) the connection for one link. */
  private openLink(index: number): Link | null {
    const existing = this.links[index]
    if (existing) return existing
    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    } catch {
      if (index === 0) this.fail('This browser can\u2019t open a direct connection.')
      return null
    }
    const link: Link = { index, pc, channel: null, pendingIce: [] }
    this.links[index] = link

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.handlers.onSignal({
          t: 'rtc-ice',
          reqId: this.reqId,
          link: index,
          candidate: ev.candidate.toJSON(),
        })
      }
    }
    pc.onconnectionstatechange = () => {
      // one link failing is survivable; losing every one is not
      if (pc.connectionState === 'failed' && !this.openChannels().length && !this.pumping) {
        this.fail(UNREACHABLE)
      }
    }

    if (this.role === 'sender') {
      const channel = pc.createDataChannel('files', { ordered: false })
      channel.binaryType = 'arraybuffer'
      this.bindChannel(link, channel)
      void (async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          this.handlers.onSignal({
            t: 'rtc-offer',
            reqId: this.reqId,
            link: index,
            sdp: offer.sdp ?? '',
          })
        } catch {
          if (index === 0) this.fail(UNREACHABLE)
        }
      })()
    } else {
      pc.ondatachannel = (ev) => {
        ev.channel.binaryType = 'arraybuffer'
        this.bindChannel(link, ev.channel)
      }
    }
    return link
  }

  private openChannels(): RTCDataChannel[] {
    return this.links
      .filter((l) => l?.channel?.readyState === 'open')
      .map((l) => l.channel!)
  }

  private bindChannel(link: Link, channel: RTCDataChannel): void {
    link.channel = channel
    channel.bufferedAmountLowThreshold = LOW_WATER

    const onOpen = () => {
      clearTimeout(this.connectTimer)
      if (this.links.filter((l) => l?.channel?.readyState === 'open').length === 1) {
        this.diag.mark('channel-open')
        this.diag.noteChunk(this.chunkSize(), link.pc.sctp?.maxMessageSize ?? 0)
        this.diag.startSampling(
          () => this.links.filter((l) => l?.channel?.readyState === 'open').map((l) => l.pc),
          () => this.stats.bytesDone,
          // sender: what's queued across every link; receiver: unwritten bytes
          () =>
            this.role === 'sender'
              ? this.openChannels().reduce((n, c) => n + c.bufferedAmount, 0)
              : this.pendingBytes
        )
      }
      if (this.role !== 'sender' || this.pumping) return
      // give the remaining links a moment to come up, then send over all of them
      const ready = this.openChannels().length
      if (ready >= LINKS) {
        clearTimeout(this.gatherTimer)
        this.startPump()
      } else if (!this.gatherTimer) {
        this.gatherTimer = setTimeout(() => this.startPump(), LINK_GATHER_MS)
      }
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
      // only a total loss of connectivity is fatal
      if (this.finished || this.aborted || this.sawDone) return
      if (!this.openChannels().length) this.fail('Connection lost')
    }
  }

  /**
   * Per-link queue ceiling, sized from throughput so far. Starts small: at the
   * beginning there is no measurement, and guessing high is what caused the
   * overshoot in the first place.
   */
  private queueLimit(): number {
    const links = Math.max(1, this.openChannels().length)
    const secs = (performance.now() - this.pumpStartedAt) / 1000
    if (secs < 1 || this.stats.bytesDone <= 0) return MIN_QUEUE / links
    const rate = this.stats.bytesDone / secs
    const budget = Math.min(MAX_QUEUE, Math.max(MIN_QUEUE, rate * QUEUE_SECONDS))
    return budget / links
  }

  private startPump(): void {
    if (this.pumping || this.aborted || this.finished) return
    this.pumping = true
    this.pumpStartedAt = performance.now()
    clearTimeout(this.gatherTimer)
    void this.pump()
  }

  // --- signaling from the peer ---------------------------------------------

  async handleOffer(index: number, sdp: string): Promise<void> {
    const link = this.openLink(index)
    if (!link) return
    try {
      await link.pc.setRemoteDescription({ type: 'offer', sdp })
      await this.flushIce(link)
      const answer = await link.pc.createAnswer()
      await link.pc.setLocalDescription(answer)
      if (index === 0) this.diag.mark('answer-sent')
      this.handlers.onSignal({
        t: 'rtc-answer',
        reqId: this.reqId,
        link: index,
        sdp: answer.sdp ?? '',
      })
    } catch {
      if (index === 0 && !this.openChannels().length) this.fail(UNREACHABLE)
    }
  }

  async handleAnswer(index: number, sdp: string): Promise<void> {
    const link = this.links[index]
    if (!link) return
    try {
      await link.pc.setRemoteDescription({ type: 'answer', sdp })
      await this.flushIce(link)
    } catch {
      if (index === 0 && !this.openChannels().length) this.fail(UNREACHABLE)
    }
  }

  async handleIce(index: number, candidate: RTCIceCandidateInit): Promise<void> {
    const link = this.links[index]
    if (!link) return
    if (!link.pc.remoteDescription) {
      link.pendingIce.push(candidate)
      return
    }
    await link.pc.addIceCandidate(candidate).catch(() => {})
  }

  private async flushIce(link: Link): Promise<void> {
    const queued = link.pendingIce
    link.pendingIce = []
    for (const c of queued) await link.pc.addIceCandidate(c).catch(() => {})
  }

  // --- sending -------------------------------------------------------------

  private chunkSize(): number {
    // browsers report what SCTP negotiated (Chrome: 256 KB); 16 KB is only the
    // universally-safe floor, and using it needlessly quadruples message count
    const max = this.links[0]?.pc.sctp?.maxMessageSize ?? 0
    return max > RTC_CHUNK ? Math.min(max, MAX_RTC_CHUNK) : RTC_CHUNK
  }

  /** The open channel with the smallest backlog. */
  private leastBusy(): RTCDataChannel | null {
    const open = this.openChannels()
    if (!open.length) return null
    return open.reduce((a, b) => (a.bufferedAmount <= b.bufferedAmount ? a : b))
  }

  /** Any open channel — control messages don't care which link carries them. */
  private control(): RTCDataChannel | null {
    return this.openChannels()[0] ?? null
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
    const stale = () => this.aborted || this.finished
    const files = this.files
    try {
      const open = this.openChannels()
      if (!open.length) return
      // On every link, not just one: chunks go down whichever link is idlest,
      // so a manifest sent over a single link can be overtaken by data on
      // another. It is a few hundred bytes and the receiver ignores repeats.
      // a staged file that reads as empty is almost always a stale handle, not
      // a genuinely empty file the user meant to send
      const unreadable = files.find((f) => f.size === 0)
      if (unreadable && files.some((f) => f.size > 0)) {
        this.fail(`“${unreadable.name}” is empty or no longer readable — pick it again.`)
        return
      }
      const manifest = JSON.stringify({
        t: 'manifest',
        files: files.map((f) => ({ n: f.name, s: f.size })),
        bytes: this.stats.bytesTotal,
      })
      for (const c of open) c.send(manifest)
      const sums: number[] = []

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

        let sentForFile = 0
        let sum = 0
        let inFlight: Promise<ArrayBuffer> | null = readAt(0)
        for (let off = 0; off < file.size; off += READ_BLOCK) {
          if (stale()) return
          const block = await inFlight!
          sum = crc32(new Uint8Array(block), sum)
          const next = off + READ_BLOCK
          inFlight = next < file.size ? readAt(next) : null

          for (let p = 0; p < block.byteLength; p += chunk) {
            if (stale()) return
            // send down whichever link has the least queued: each has its own
            // congestion window, so the fastest one naturally takes the most
            let out = this.leastBusy()
            if (!out) return
            if (out.bufferedAmount > this.queueLimit()) {
              await this.drain(out)
              if (stale()) return
              out = this.leastBusy()
              if (!out) return
            }
            const end = Math.min(p + chunk, block.byteLength)
            const payload = new Uint8Array(HEADER + (end - p))
            const head = new DataView(payload.buffer)
            head.setUint32(0, i)
            head.setFloat64(4, off + p)
            payload.set(new Uint8Array(block, p, end - p), HEADER)
            out.send(payload.buffer)
            if (!this.sawFirstByte) { this.sawFirstByte = true; this.diag.mark('first-byte') }
            sentForFile += end - p
            this.stats.bytesDone += end - p
            this.emit()
          }
        }

        // A File handle can go stale between being staged and being read —
        // a picked photo on iOS is the usual way — and it then reads as empty.
        // Announcing a size and delivering less would hand over a truncated or
        // 0-byte file that both sides call a success.
        if (sentForFile !== file.size) {
          this.fail(
            `“${file.name}” could not be read in full — pick it again and retry.`
          )
          return
        }

        sums[i] = sum
        this.stats.filesDone++
        this.emit(true)
      }

      if (stale()) return
      // what the sender read, so the receiver can check what it stored
      this.control()?.send(JSON.stringify({ t: 'sums', sums }))
      this.control()?.send(JSON.stringify({ t: 'done' }))
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
      if (this.manifest.length) return // sent on every link; first one wins
      this.manifest = Array.isArray(msg.files) ? msg.files : []
      this.received = this.manifest.map(() => 0)
      this.stats.filesTotal = this.manifest.length
      this.stats.bytesTotal = Number(msg.bytes) || this.manifest.reduce((n, f) => n + f.s, 0)
      this.emit(true)
      // now that sizes are known, the chunks that beat the manifest can land
      const held = this.early
      this.early = []
      this.earlyBytes = 0
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
    } else if (msg?.t === 'sums') {
      this.expectedSums = Array.isArray((msg as any).sums) ? (msg as any).sums : []
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
      // Bounded by bytes so a peer that never sends a manifest can't exhaust
      // memory — but dropping one of these silently loses part of the file and
      // leaves it never completing, so it is an error, not a quiet discard.
      if (this.earlyBytes + buf.byteLength > MAX_EARLY_BYTES) {
        this.fail('The sender started before saying what it was sending.')
        return
      }
      this.early.push(buf)
      this.earlyBytes += buf.byteLength
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

  /**
   * Read each stored file back and compare it with what the sender read.
   *
   * Byte counts already prove nothing was lost in transit; this proves nothing
   * was put in the wrong place or silently failed to write, which counting
   * cannot see.
   */
  private async verifyAll(): Promise<void> {
    if (!this.target?.checksum) return
    for (let i = 0; i < this.manifest.length; i++) {
      if (this.aborted) return
      const want = this.expectedSums[i]
      if (typeof want !== 'number') continue
      const got = await this.target.checksum(this.manifest[i].n).catch(() => null)
      if (got === null) continue // this target can't read back; counts still held
      if (got !== want) {
        this.fail(`“${this.manifest[i].n}” arrived damaged — ask them to send it again.`)
        return
      }
    }
    this.diag.mark('verified')
  }

  /** A file has all its bytes — close it and see whether that was the last. */
  private closeFile(index: number): void {
    if (this.closed.has(index)) return
    this.closed.add(index)
    this.flushPending()
    this.enqueue(async () => {
      const sink = await this.sinkFor(index)
      const want = this.manifest[index]?.s ?? 0
      const got = this.received[index] ?? 0
      // closing here would commit whatever did arrive — a short or empty file
      // handed over as if it were the real one
      if (got < want) {
        await sink?.abort().catch(() => {})
        this.sinks.delete(index)
        this.fail('The transfer finished early and the file is incomplete.')
        return
      }
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
    // the sums are the last thing the sender sends before 'done'; without them
    // there is nothing to verify against, so wait
    if (!this.expectedSums.length) return
    this.sawAllBytes = true
    this.flushPending()
    this.enqueue(async () => {
      await this.verifyAll()
      if (this.aborted) return
      await this.target?.finish()
      // tell the sender before we settle: this is what lets it report "Sent"
      // truthfully, and it must go out while the channel is still open
      try {
        this.control()?.send(JSON.stringify({ t: 'ack' }))
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
      this.control()?.send(JSON.stringify({ t: 'abort' }))
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
    if (!DIAGNOSTICS) return
    this.diag.mark(outcome.startsWith('completed') ? 'done' : 'error')
    this.diag.stop()
    const text = this.diag.report(outcome, this.stats.bytesDone)
    storeReport(text)
    // console too, so it survives the window being dismissed
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
    clearTimeout(this.gatherTimer)
    for (const link of this.links) {
      if (!link) continue
      link.channel?.close()
      link.channel = null
      link.pc.close()
    }
    this.links = []
  }

  /** Component unmount / room teardown — stop without notifying anyone. */
  dispose(): void {
    this.aborted = true
    this.cleanupPartial()
    this.teardown()
  }
}
