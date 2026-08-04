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

const SAMPLE_MS = 250

/**
 * Diagnostics are off for ordinary users: the per-sample getStats() polling
 * across every link costs real work during a transfer, and the report is
 * meaningless to anyone not debugging one. On in development, and switchable on
 * in production with `localStorage['webshare:debug'] = '1'` so a real device on
 * a real network can still be measured.
 */
export const DIAGNOSTICS: boolean = (() => {
  // import.meta.env only exists under Vite; guard it so this module can also be
  // loaded outside the bundler (tests, tooling) without exploding
  if (import.meta.env?.DEV) return true
  try {
    return localStorage.getItem('webshare:debug') === '1'
  } catch {
    return false // storage blocked (private mode) — treat as off
  }
})()
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
  // connection failures always store one, so it has to be readable with the
  // flag off; only the verbose transfer report is gated
  if (!DIAGNOSTICS) {
    try {
      const r = localStorage.getItem(LAST_REPORT_KEY)
      return r?.startsWith('connection report') ? r : null
    } catch {
      return null
    }
  }
  try {
    return localStorage.getItem(LAST_REPORT_KEY)
  } catch {
    return null
  }
}

/**
 * What happened while trying to connect, kept whether or not diagnostics are
 * switched on. A failure to connect is precisely the moment someone needs this,
 * and there is no transfer running to slow down.
 */
export class ConnectLog {
  private readonly t0 = performance.now()
  private readonly events: string[] = []
  private readonly localTypes = new Set<string>()
  private readonly remoteTypes = new Set<string>()
  private mdnsLocal = false
  private mdnsRemote = false

  note(text: string): void {
    if (this.events.length < 80) {
      this.events.push(`${((performance.now() - this.t0) / 1000).toFixed(1)}s ${text}`)
    }
  }

  candidate(side: 'local' | 'remote', c: RTCIceCandidateInit): void {
    // "candidate:... typ host ..." — the type is what says whether a usable
    // path was even found, and a .local address is an mDNS name the other side
    // has to resolve, which many public networks refuse to carry
    const text = c.candidate ?? ''
    const type = /typ (\w+)/.exec(text)?.[1] ?? 'unknown'
    const isMdns = /\.local/.test(text)
    if (side === 'local') {
      this.localTypes.add(type)
      if (isMdns) this.mdnsLocal = true
    } else {
      this.remoteTypes.add(type)
      if (isMdns) this.mdnsRemote = true
    }
  }

  /** Everything known about why a connection did or didn't come up. */
  async report(peers: RTCPeerConnection[]): Promise<string> {
    const lines: string[] = ['connection report', '']
    const list = (s: Set<string>) => (s.size ? [...s].join(', ') : 'none')
    lines.push(`our candidates    ${list(this.localTypes)}${this.mdnsLocal ? ' (mDNS .local)' : ''}`)
    lines.push(`their candidates  ${list(this.remoteTypes)}${this.mdnsRemote ? ' (mDNS .local)' : ''}`)

    let pairs = 0
    let succeeded = 0
    const states = new Set<string>()
    for (const pc of peers) {
      const stats = await pc.getStats().catch(() => null)
      stats?.forEach((r: any) => {
        if (r.type === 'candidate-pair') {
          pairs++
          states.add(r.state)
          if (r.state === 'succeeded') succeeded++
        }
      })
    }
    lines.push(`candidate pairs   ${pairs} tried, ${succeeded} succeeded`)
    if (states.size) lines.push(`pair states       ${[...states].join(', ')}`)
    lines.push('')

    // say what it most likely means, since the raw fields don't
    if (this.localTypes.size && !this.remoteTypes.size) {
      lines.push('the other device never sent any candidates — it may not have')
      lines.push('got our request, or its own gathering failed.')
    } else if (pairs === 0 && this.mdnsRemote && !this.mdnsLocal) {
      lines.push('their addresses came as .local mDNS names and ours did not.')
      lines.push('this device has to look those names up over the network to')
      lines.push('get an address, and no pair was ever formed — so the lookups')
      lines.push('returned nothing. that is the network blocking mDNS, which')
      lines.push('public and guest Wi-Fi commonly does.')
      lines.push('')
      lines.push('the other device may still be able to reach us, since our')
      lines.push('address was sent in the clear. their report will show whether')
      lines.push('they got pairs — if they did not either, the network is also')
      lines.push('keeping its clients apart and nothing here can bridge that.')
    } else if (pairs === 0) {
      lines.push('no candidate pairs were formed at all. if both sides listed')
      lines.push('candidates above, they never reached the connection — check')
      lines.push('the events below for a rejected candidate or a handshake')
      lines.push('that stopped partway.')
    } else if (pairs > 0 && succeeded === 0) {
      lines.push('both sides offered addresses and every pair failed. that is')
      lines.push('the network refusing to carry traffic between two of its own')
      lines.push('clients — "client isolation", normal on public and guest')
      lines.push('Wi-Fi. nothing in the app can get around it.')
    } else if (this.mdnsLocal || this.mdnsRemote) {
      lines.push('addresses were exchanged as .local mDNS names, which the')
      lines.push('other device has to resolve over the network. many public')
      lines.push('networks block that, which leaves nothing to connect to.')
    }
    lines.push(`ice states        ${[...states].join(', ') || 'none recorded'}`)
    lines.push('')
    lines.push(...this.events)
    lines.push(`ua: ${navigator.userAgent}`)
    return lines.join('\n')
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
  /** cumulative ms the sender spent waiting on disk reads */
  private readMs = 0
  /** wire bytes ÷ payload bytes; above 1 means the link made us re-send */
  private retransmitRatio: number | undefined

  private readonly role: 'sender' | 'receiver'

  constructor(role: 'sender' | 'receiver') {
    this.role = role
    this.mark('created')
  }

  mark(label: string): void {
    this.marks.push({ label, at: performance.now() - this.t0 })
  }

  addReadTime(ms: number): void {
    this.readMs += ms
  }

  private linkCount = 0

  noteChunk(chunk: number, maxMessage: number): void {
    this.chunk = chunk
    this.maxMessage = maxMessage
  }

  /** Poll the connection while data flows. Safe to call more than once. */
  startSampling(
    peers: () => RTCPeerConnection[],
    bytesSoFar: () => number,
    backlog: () => number
  ): void {
    if (this.timer || !DIAGNOSTICS) return
    const take = () => {
      const sample: Sample = {
        t: performance.now() - this.t0,
        bytes: bytesSoFar(),
        backlog: backlog(),
      }
      this.samples.push(sample)
      // Every link has its own stats. Reading only the first made the wire
      // total a fraction of the payload — a ratio below 1.0, which is
      // impossible and was the clue that the links were in fact all working.
      const links = peers()
      this.linkCount = Math.max(this.linkCount, links.length)
      let wire = 0
      let rttSum = 0
      let rttCount = 0
      void Promise.all(links.map((pc) => pc.getStats().catch(() => null))).then((all) => {
        for (const stats of all) {
          if (!stats) continue
          stats.forEach((r: any) => {
          if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded')) {
            if (typeof r.currentRoundTripTime === 'number') {
              rttSum += r.currentRoundTripTime * 1000
              rttCount++
            }
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
              if (typeof n === 'number') wire += n
            }
          })
        }
        if (rttCount) sample.rttMs = rttSum / rttCount
        if (wire > 0) sample.wireBytes = wire
      }).catch(() => {})
    }
    // take one immediately, so the wire-vs-payload baseline spans the whole run
    take()
    this.timer = setInterval(take, SAMPLE_MS)
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
    const mbps =
      first !== undefined && end !== undefined && end > first
        ? totalBytes / 1048576 / ((end - first) / 1000)
        : undefined

    if (this.path.localType && this.path.localType !== 'host') {
      out.push(`  - path is '${this.path.localType}', not a direct LAN hop`)
    }

    // Stalls are the clearest symptom of a lossy link: with ordered delivery a
    // dropped packet holds up everything behind it while SCTP backs off, so the
    // stream goes completely silent rather than merely slowing down.
    let worst = 0
    let stalled = 0
    // Was the wire busy while the stream was silent? If bytes kept arriving
    // that we couldn't hand over, an earlier lost packet was holding the
    // ordered stream up (head-of-line blocking) and splitting the file across
    // independent streams would keep it moving. If the wire went quiet too,
    // congestion control had shut the whole association down and extra streams
    // over the same connection would have stalled with it.
    let wireBusyDuringStalls = 0
    let wireQuietDuringStalls = 0
    let runStart: number | null = null
    for (let i = 1; i < this.samples.length; i++) {
      const moved = this.samples[i].bytes - this.samples[i - 1].bytes
      if (moved < 16 * 1024) {
        if (runStart === null) runStart = i - 1
      } else if (runStart !== null) {
        const from = this.samples[runStart]
        const to = this.samples[i - 1]
        const len = to.t - from.t
        if (len > 0) {
          worst = Math.max(worst, len)
          stalled += len
          if (from.wireBytes !== undefined && to.wireBytes !== undefined) {
            const onWire = to.wireBytes - from.wireBytes
            if (onWire > 64 * 1024) wireBusyDuringStalls += len
            else wireQuietDuringStalls += len
          }
        }
        runStart = null
      }
    }
    if (worst > 500) {
      const share = end !== undefined && first !== undefined ? (stalled / (end - first)) * 100 : 0
      out.push(`  - the stream went silent for up to ${(worst / 1000).toFixed(1)}s`)
      out.push(`    (${(stalled / 1000).toFixed(1)}s total, ${share.toFixed(0)}% of the transfer)`)
      if (wireBusyDuringStalls > wireQuietDuringStalls) {
        out.push('    bytes kept arriving through the silence: an earlier lost')
        out.push('    packet was blocking the ordered stream. splitting the file')
        out.push('    across independent streams would keep it moving.')
      } else if (wireQuietDuringStalls > 0) {
        out.push('    nothing arrived at all through the silence: congestion')
        out.push('    control shut the connection down, so extra streams over')
        out.push('    the same connection would stall with it.')
      } else {
        out.push('    that is packet loss stalling an ordered stream, not the app')
      }
    }

    if (this.retransmitRatio !== undefined && this.retransmitRatio > 1.08) {
      out.push(
        `  - ${((this.retransmitRatio - 1) * 100).toFixed(0)}% of what went on the wire was re-sent: the link is dropping packets`
      )
    }

    if (median !== undefined) {
      if (median > 40) {
        out.push(`  - round-trip ${median.toFixed(0)} ms is far above a healthy LAN (2-10 ms):`)
        out.push('    the wireless link is congested, weak, or power-saving.')
      } else {
        out.push(`  - link latency is healthy (${median.toFixed(0)} ms)`)
      }
    }

    const backlogs = this.samples.map((x) => x.backlog)
    if (this.role === 'sender') {
      const full = backlogs.filter((b) => b > 1024 * 1024).length / (backlogs.length || 1)
      if (full > 0.3) {
        out.push('  - the send buffer stays full: the network is the limit, not us')
      } else if (mbps !== undefined && mbps < 2) {
        out.push('  - the send buffer stays near empty while throughput is low:')
        out.push('    the sender is being starved (disk, CPU, or backgrounding).')
      }
    } else {
      // the receiver buffers up to WRITE_BLOCK on purpose, so only a backlog
      // well past that means the disk is genuinely falling behind
      const drowning = backlogs.filter((b) => b > 2 * 1024 * 1024).length / (backlogs.length || 1)
      if (drowning > 0.3) {
        out.push('  - unwritten data keeps growing: the disk is the limit on this side')
      }
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
    push('links', this.linkCount)
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
    if (this.role === 'sender' && first !== undefined && end > first && this.readMs > 0) {
      const share = (this.readMs / (end - first)) * 100
      push('disk read time', `${this.readMs.toFixed(0)} ms (${share.toFixed(0)}% of transfer)`)
    }
    // heavy retransmission shows up as far more on the wire than in the file
    const wire = this.samples.filter((x) => x.wireBytes !== undefined)
    if (wire.length > 1 && totalBytes > 0) {
      const moved = wire[wire.length - 1].wireBytes! - wire[0].wireBytes!
      if (moved > 0) {
        this.retransmitRatio = moved / totalBytes
        push('wire vs payload', `${this.retransmitRatio.toFixed(2)}x (1.0 = no retransmits)`)
      }
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
