/**
 * Per-transfer instrumentation.
 *
 * A slow transfer has several possible causes that look identical from the
 * outside: the handshake ate the time, the link itself is slow, our own
 * backpressure is stalling the sender, or the connection isn't actually direct.
 * These record enough to tell them apart from a single real run between two
 * real devices — which is the only place the answer can come from.
 */

interface Mark {
  label: string
  at: number
}

interface Sample {
  t: number
  bytes: number
  /**
   * Sender: bytes queued on the data channel. Receiver: bytes received but not
   * yet written. Either way it answers "is this side holding things up" — the
   * send buffer is meaningless on the receiver, which only ever sends an ack,
   * so this has to be role-specific rather than always bufferedAmount.
   */
  backlog: number
  rttMs?: number
  /** bytes the transport actually put on the wire, retransmissions included */
  wireBytes?: number
}

export interface PathInfo {
  localType?: string
  remoteType?: string
  localAddress?: string
  remoteAddress?: string
  protocol?: string
  networkType?: string
}

const SAMPLE_MS = 500
const LAST_REPORT_KEY = 'webshare:lastReport'

/** Keep the most recent report so it can be read after the window is gone. */
export function storeReport(text: string): void {
  try {
    localStorage.setItem(LAST_REPORT_KEY, text)
  } catch {
    /* private mode / quota — the console copy is still there */
  }
}

export function loadReport(): string | null {
  try {
    return localStorage.getItem(LAST_REPORT_KEY)
  } catch {
    return null
  }
}

export class TransferDiag {
  private readonly t0 = performance.now()
  private readonly marks: Mark[] = []
  private readonly samples: Sample[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  private path: PathInfo = {}
  private chunk = 0
  private maxMessage = 0

  private readonly role: 'sender' | 'receiver'

  constructor(role: 'sender' | 'receiver') {
    this.role = role
    this.mark('created')
  }

  mark(label: string): void {
    this.marks.push({ label, at: performance.now() - this.t0 })
  }

  noteChunk(chunk: number, maxMessage: number): void {
    this.chunk = chunk
    this.maxMessage = maxMessage
  }

  /** Poll the connection while data flows. Safe to call more than once. */
  startSampling(
    pc: RTCPeerConnection | null,
    bytesSoFar: () => number,
    backlog: () => number
  ): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      const sample: Sample = {
        t: performance.now() - this.t0,
        bytes: bytesSoFar(),
        backlog: backlog(),
      }
      this.samples.push(sample)
      // getStats is async; fill the numbers in on the sample we just pushed
      void pc?.getStats().then((stats) => {
        stats.forEach((r: any) => {
          if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded')) {
            if (typeof r.currentRoundTripTime === 'number') sample.rttMs = r.currentRoundTripTime * 1000
            const local = stats.get(r.localCandidateId) as any
            const remote = stats.get(r.remoteCandidateId) as any
            if (local) {
              this.path.localType = local.candidateType
              this.path.localAddress = local.address ?? local.ip
              this.path.protocol = local.protocol
              this.path.networkType = local.networkType
            }
            if (remote) {
              this.path.remoteType = remote.candidateType
              this.path.remoteAddress = remote.address ?? remote.ip
            }
          }
          // transport totals include retransmissions, so comparing them with
          // the payload shows how much the link is making us re-send
          if (r.type === 'transport') {
            const n = this.role === 'sender' ? r.bytesSent : r.bytesReceived
            if (typeof n === 'number') sample.wireBytes = n
          }
        })
      }).catch(() => {})
    }, SAMPLE_MS)
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private at(label: string): number | undefined {
    return this.marks.find((m) => m.label === label)?.at
  }

  /**
   * Read the numbers back in plain language. The same slow transfer can be the
   * link, our own pacing, or the disk, and the distinguishing evidence is
   * spread across three columns — so state the conclusion rather than leaving
   * it to be re-derived every time.
   */
  private verdict(totalBytes: number, first?: number, end?: number): string[] {
    const out: string[] = ['verdict:']
    const rtts = this.samples.map((x) => x.rttMs).filter((n): n is number => n !== undefined)
    const median = rtts.length ? [...rtts].sort((a, b) => a - b)[Math.floor(rtts.length / 2)] : undefined
    const backlogs = this.samples.map((x) => x.backlog)
    const busy = backlogs.filter((b) => b > 256 * 1024).length / (backlogs.length || 1)
    const mbps =
      first !== undefined && end !== undefined && end > first
        ? totalBytes / 1048576 / ((end - first) / 1000)
        : undefined

    if (this.path.localType && this.path.localType !== 'host') {
      out.push(`  - path is '${this.path.localType}', not a direct LAN hop`)
    }
    if (median !== undefined) {
      if (median > 40) {
        out.push(`  - round-trip ${median.toFixed(0)} ms is far above a healthy LAN (2-10 ms):`)
        out.push('    the wireless link is congested, weak, or power-saving.')
        out.push('    this caps throughput no matter what the app does.')
      } else {
        out.push(`  - link latency is healthy (${median.toFixed(0)} ms)`)
      }
    }
    if (this.role === 'sender') {
      if (busy > 0.3) {
        out.push('  - the send buffer stays full: the network is the limit, not us')
      } else if (mbps !== undefined && mbps < 2) {
        out.push('  - the send buffer stays near empty while throughput is low:')
        out.push('    the sender is being starved (disk, CPU, or backgrounding),')
        out.push('    or the link is refusing to take data faster.')
      }
    } else if (busy > 0.3) {
      out.push('  - unwritten data is piling up: the disk is the limit on this side')
    }
    if (out.length === 1) out.push('  - nothing anomalous')
    return out
  }

  /** Plain text, meant to be copied straight into a bug report. */
  report(outcome: string, totalBytes: number): string {
    const open = this.at('channel-open')
    const first = this.at('first-byte')
    const end = this.at('done') ?? this.at('error') ?? performance.now() - this.t0

    const lines: string[] = []
    const push = (k: string, v: string | number | undefined) => {
      if (v !== undefined && v !== '') lines.push(`${k.padEnd(16)} ${v}`)
    }

    lines.push(`webshare transfer report (${this.role}) — ${outcome}`)
    lines.push('')

    // --- where the time went ---
    push('handshake', open !== undefined ? `${open.toFixed(0)} ms` : 'never connected')
    if (first !== undefined) {
      const wireSecs = (end - first) / 1000
      push('time to 1st byte', `${first.toFixed(0)} ms`)
      push('transfer time', `${wireSecs.toFixed(2)} s`)
      push('payload', `${(totalBytes / 1048576).toFixed(2)} MB`)
      if (wireSecs > 0.05) {
        const mbps = totalBytes / 1048576 / wireSecs
        push('THROUGHPUT', `${mbps.toFixed(2)} MB/s  (${(mbps * 1024).toFixed(0)} KB/s)`)
      }
      // what the old, wrong formula would have said — keeps the two separable
      const lifetime = totalBytes / 1048576 / (end / 1000)
      push('(incl handshake)', `${lifetime.toFixed(2)} MB/s`)
    }
    lines.push('')

    // --- was it really direct, and over what ---
    push('local candidate', `${this.path.localType ?? '?'} ${this.path.localAddress ?? ''}`.trim())
    push('remote candidate', `${this.path.remoteType ?? '?'} ${this.path.remoteAddress ?? ''}`.trim())
    push('protocol', this.path.protocol)
    push('network', this.path.networkType)
    push('chunk size', this.chunk ? `${(this.chunk / 1024).toFixed(0)} KB` : undefined)
    push('sctp max msg', this.maxMessage ? `${(this.maxMessage / 1024).toFixed(0)} KB` : undefined)

    // RTT is the clearest read on the link itself: a healthy LAN is single
    // digits, and anything near 100 ms means the path is queueing or lossy
    const rtts = this.samples.map((x) => x.rttMs).filter((n): n is number => n !== undefined)
    if (rtts.length) {
      const sorted = [...rtts].sort((a, b) => a - b)
      push('rtt median', `${sorted[Math.floor(sorted.length / 2)].toFixed(0)} ms`)
      push(
        'rtt p90/max',
        `${sorted[Math.floor(sorted.length * 0.9)].toFixed(0)} / ${sorted[sorted.length - 1].toFixed(0)} ms`
      )
    }
    // heavy retransmission shows up as far more on the wire than in the file
    const wire = this.samples.filter((x) => x.wireBytes !== undefined)
    if (wire.length > 1 && totalBytes > 0) {
      const moved = wire[wire.length - 1].wireBytes! - wire[0].wireBytes!
      if (moved > 0) push('wire vs payload', `${(moved / totalBytes).toFixed(2)}x (1.0 = no retransmits)`)
    }
    lines.push('')

    // --- per-second detail: rate, our backlog, the path's own estimate ---
    if (this.samples.length > 1) {
      const label = this.role === 'sender' ? 'sendbuf' : 'unwritten'
      lines.push(`t(s)   MB     rate      ${label.padStart(9)}   rtt`)
      let prev = this.samples[0]
      for (const s of this.samples.slice(1)) {
        const dt = (s.t - prev.t) / 1000
        const rate = dt > 0 ? (s.bytes - prev.bytes) / 1048576 / dt : 0
        lines.push(
          [
            (s.t / 1000).toFixed(1).padStart(5),
            (s.bytes / 1048576).toFixed(1).padStart(6),
            `${rate.toFixed(1)} MB/s`.padStart(9),
            `${(s.backlog / 1024).toFixed(0)} KB`.padStart(11),
            s.rttMs !== undefined ? `${s.rttMs.toFixed(0)}ms`.padStart(7) : '      -',
          ].join(' ')
        )
        prev = s
      }
      lines.push('')
    }

    for (const v of this.verdict(totalBytes, first, end)) lines.push(v)
    lines.push('')
    lines.push(`marks: ${this.marks.map((m) => `${m.label}@${m.at.toFixed(0)}ms`).join(' → ')}`)
    lines.push(`ua: ${navigator.userAgent}`)
    return lines.join('\n')
  }
}
