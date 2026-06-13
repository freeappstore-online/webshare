import { fileKind } from './files'

/**
 * Preview for a staged file: the image itself, a video's first frame
 * (QuickTime .mov, MP4, M4V, …), or audio's embedded album art (MP3 ID3,
 * AAC/M4A covr). Resolves null when the file has no visual preview.
 */
export async function fileThumb(file: File): Promise<string | null> {
  try {
    const kind = fileKind(file)
    if (kind === 'video') return await videoFrame(file)
    // audio: album art first; containers that overlap with video (3gp, ogg,
    // webm, …) may still hold a video track, so try a frame as a fallback
    if (kind === 'audio') return (await audioArt(file)) ?? (await videoFrame(file))
    // anything else: see if the browser can actually decode it as an image —
    // trust the decode, not the MIME type or extension
    return await imageThumb(file)
  } catch {
    return null
  }
}

/** Object URL only if the file really decodes as an image. */
function imageThumb(file: File): Promise<string | null> {
  // don't try to decode huge blobs that don't even claim to be images
  if (!file.type.startsWith('image/') && file.size > 32 * 1024 * 1024) return Promise.resolve(null)
  const url = URL.createObjectURL(file)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0 ? url : (URL.revokeObjectURL(url), null))
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** Seek a hidden <video> just past the start and snapshot it onto a canvas. */
function videoFrame(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (result: string | null) => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      resolve(result)
    }
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onloadedmetadata = () => {
      // a hair in so we don't grab a black pre-roll frame
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2)
    }
    video.onseeked = () => {
      try {
        if (!video.videoWidth) return done(null)
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d')!.drawImage(video, 0, 0)
        done(canvas.toDataURL('image/jpeg', 0.75))
      } catch {
        done(null)
      }
    }
    video.onerror = () => done(null)
    video.src = url
  })
}

/** Album art from the file's head: ID3v2 APIC (MP3) or MP4 covr (AAC/M4A). */
async function audioArt(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer())
  return id3Art(head) ?? mp4CovrArt(head)
}

function id3Art(b: Uint8Array): string | null {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null // "ID3"
  const major = b[3]
  const syncsafe = (o: number) =>
    ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
  const end = Math.min(10 + syncsafe(6), b.length)
  let off = 10
  while (off + 10 <= end) {
    const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3])
    const frameSize =
      major === 4
        ? syncsafe(off + 4)
        : (b[off + 4] << 24) | (b[off + 5] << 16) | (b[off + 6] << 8) | b[off + 7]
    if (!frameSize || !/^[A-Z0-9]{4}$/.test(id)) break
    if (id === 'APIC') {
      let p = off + 10
      const frameEnd = Math.min(p + frameSize, b.length)
      const encoding = b[p++]
      let mimeEnd = p
      while (mimeEnd < frameEnd && b[mimeEnd] !== 0) mimeEnd++
      const mime = String.fromCharCode(...Array.from(b.slice(p, mimeEnd)))
      p = mimeEnd + 1
      p++ // picture type byte
      if (encoding === 1 || encoding === 2) {
        // UTF-16 description ends with a double null
        while (p + 1 < frameEnd && !(b[p] === 0 && b[p + 1] === 0)) p += 2
        p += 2
      } else {
        while (p < frameEnd && b[p] !== 0) p++
        p += 1
      }
      const img = b.slice(p, frameEnd)
      if (!img.length) return null
      return URL.createObjectURL(new Blob([img], { type: mime || 'image/jpeg' }))
    }
    off += 10 + frameSize
  }
  return null
}

function mp4CovrArt(b: Uint8Array): string | null {
  // scan for the 'covr' atom; its 'data' child carries the image payload
  for (let i = 0; i + 24 < b.length; i++) {
    if (b[i] !== 0x63 || b[i + 1] !== 0x6f || b[i + 2] !== 0x76 || b[i + 3] !== 0x72) continue
    const d = i + 4 // start of the data atom: [size][`data`][type][locale][payload]
    const size = (b[d] << 24) | (b[d + 1] << 16) | (b[d + 2] << 8) | b[d + 3]
    if (String.fromCharCode(b[d + 4], b[d + 5], b[d + 6], b[d + 7]) !== 'data') continue
    if (size <= 16) return null
    const flag = b[d + 11] // 13 = jpeg, 14 = png
    const payload = b.slice(d + 16, d + size)
    if (!payload.length) return null
    return URL.createObjectURL(new Blob([payload], { type: flag === 14 ? 'image/png' : 'image/jpeg' }))
  }
  return null
}

// prettier-ignore
const DOC_EXTS = new Set([
  '0', '1st', '600', '602', 'abw', 'acl', 'afp', 'ami', 'ans', 'asc', 'aww',
  'bbeb', 'ccf', 'csv', 'cwk', 'dbk', 'dita', 'doc', 'docm', 'docx', 'dot',
  'dotx', 'dwd', 'egt', 'epub', 'evtx', 'ezw', 'fdx', 'ftm', 'ftx', 'gdoc',
  'guide', 'html', 'htm', 'hwp', 'hwpml', 'kpub', 'log', 'lwp', 'mbp', 'md',
  'me', 'mcw', 'mobi', 'nb', 'nbp', 'neis', 'nt', 'nq', 'odm', 'odoc', 'odt',
  'osheet', 'ott', 'omm', 'pages', 'pap', 'per', 'pdr', 'pdax', 'pdf',
  'protondoc', 'quox', 'rtf', 'rpt', 'sdw', 'se', 'stw', 'sxw', 'tex', 'tmdx',
  'info', 'troff', 'txt', 'uof', 'uoml', 'via', 'wpd', 'wps', 'wpt', 'wrd',
  'wrf', 'wri', 'wrix', 'xhtml', 'xht', 'xml', 'xps',
])

/**
 * For document files: the beginning of their text, to print on the paper
 * icon. Binary doc formats (pdf, docx, …) fail the printable-ratio check and
 * resolve null, so the paper just shows the extension instead.
 */
const MARKUP_EXTS = new Set(['html', 'htm', 'xhtml', 'xht', 'xml', 'svg'])

export interface DocPreview {
  /** rendered page snapshot (pdf, markup, …) */
  image?: string
  /** raw text to print on the paper (plain-text formats) */
  text?: string
  /** content width/height ratio when it isn't A4 portrait (landscape pdfs etc.) */
  aspect?: number
}

// rendered page size: true A4 at 96dpi, same ratio as the paper icon's page —
// text lays out with the density of a real sheet
const PAGE_W = 794
const PAGE_H = 1123

/**
 * Render a document's content to a page image (white A4 canvas) that the
 * paper icon crops and displays. PDFs render their first page via pdf.js;
 * markup renders through SVG foreignObject; plain text renders as a <pre>
 * page. Null when the content can't be rendered (e.g. binary docs).
 */
export async function docPreview(file: File): Promise<DocPreview | null> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'pdf' || file.type === 'application/pdf') {
      return await pdfPage(file)
    }
    if (!DOC_EXTS.has(ext) && !file.type.startsWith('text/')) return null

    if (['docx', 'docm', 'dotx', 'dot'].includes(ext)) {
      // OOXML — mammoth converts it to HTML (embedded images come along as
      // data URIs). Legacy binary .dot fails here and falls through.
      try {
        const mammoth = (await import('mammoth/mammoth.browser')).default
        const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
        const bodyXhtml = toXhtml(value)
        if (bodyXhtml) return { image: pageDataUrl(bodyXhtml) }
      } catch {
        /* not OOXML — keep trying the generic paths */
      }
    }

    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
    if (!head.length) return null

    // ZIP containers: odt/ott/sxw/stw, epub, xps, pages, …
    if (head[0] === 0x50 && head[1] === 0x4b) {
      const fromZip = await zipPreview(file)
      if (fromZip) return fromZip
    }

    const raw = new TextDecoder().decode(head.slice(0, 16384))
    if (/^\{\\rtf/.test(raw)) {
      const text = rtfToText(raw)
      if (text.trim()) return { image: textPage(text) }
    }

    const sample = raw.slice(0, 1000)
    let printable = 0
    for (const ch of sample) {
      const c = ch.codePointAt(0)!
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 0xfffd)) printable++
    }
    if (printable / sample.length >= 0.92) {
      if (MARKUP_EXTS.has(ext) || /^\s*</.test(raw)) {
        // real render of the markup (scripts/styles/frames stripped); external
        // media simply won't load inside the rasterized snapshot
        return { image: pageDataUrl(toXhtml(raw)) }
      }
      return { image: textPage(raw) }
    }

    // last resort for opaque binaries (doc, wpd, wps, mobi, …): salvage
    // whatever readable text is in there so nobody is left behind
    const salvaged = extractStrings(head)
    return salvaged ? { image: textPage(salvaged) } : null
  } catch {
    return null
  }
}

/** Plain text → page image (escaped <pre> through the page renderer). */
function textPage(text: string): string {
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart()
    .slice(0, 1500)
  const esc = clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return pageDataUrl(
    `<pre style="margin:0;font:13px/1.55 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word">${esc}</pre>`,
  )
}

/** Previews from inside ZIP-based document containers. */
async function zipPreview(file: File): Promise<DocPreview | null> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const names = Object.keys(zip.files).sort()

  // bundled thumbnail (Apple Pages/Keynote QuickLook, ODF Thumbnails, …)
  const art = names.find((n) =>
    /(^|\/)(QuickLook\/(Thumbnail|Preview)|Thumbnails\/thumbnail)\.(jpe?g|png)$/i.test(n),
  )
  if (art) {
    const measured = await measureImage(await zip.files[art].async('blob'))
    if (measured) return measured
  }
  const pdfInside = names.find((n) => /(^|\/)QuickLook\/Preview\.pdf$/i.test(n))
  if (pdfInside) {
    const out = await pdfPage(new File([await zip.files[pdfInside].async('blob')], 'preview.pdf'))
    if (out) return out
  }

  // ODF / StarOffice: document text lives in content.xml
  if (zip.file('content.xml')) {
    const text = xmlText(await zip.file('content.xml')!.async('string'))
    if (text) return { image: textPage(text) }
  }

  // EPUB and friends: render the first packaged (X)HTML document
  const html = names.find((n) => /\.x?html?$/i.test(n))
  if (html) {
    const bodyXhtml = toXhtml(await zip.files[html].async('string'))
    if (bodyXhtml) return { image: pageDataUrl(bodyXhtml) }
  }

  // XPS: glyph runs on the first fixed page
  const fpage = names.find((n) => /\.fpage$/i.test(n))
  if (fpage) {
    const src = await zip.files[fpage].async('string')
    const text = Array.from(src.matchAll(/UnicodeString="([^"]*)"/g))
      .map((m) => m[1])
      .join('\n')
    if (text.trim()) return { image: textPage(text) }
  }
  return null
}

/** Blob → data URL + aspect, only if it decodes as an image. */
function measureImage(blob: Blob): Promise<DocPreview | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onload = () => {
      const url = reader.result as string
      const img = new Image()
      img.onload = () =>
        resolve(
          img.naturalWidth > 0
            ? { image: url, aspect: img.naturalWidth / img.naturalHeight }
            : null,
        )
      img.onerror = () => resolve(null)
      img.src = url
    }
    reader.readAsDataURL(blob)
  })
}

/** ODF content.xml → text with paragraph breaks. */
function xmlText(xml: string): string {
  const withBreaks = xml.replace(/<\/text:(p|h)>/g, '\n$&')
  const doc = new DOMParser().parseFromString(withBreaks, 'text/xml')
  return (doc.documentElement?.textContent ?? '').trim()
}

/** Crude RTF → text: drop control tables/words, keep the prose. */
function rtfToText(rtf: string): string {
  return rtf
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info|themedata)(\{[^{}]*\}|[^{}])*\}/g, '')
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
}

/** Readable ASCII / UTF-16LE runs from a binary head — needs enough real
    words to count, so pure junk keeps the plain paper fallback. */
function extractStrings(b: Uint8Array, minRun = 6, cap = 1500): string | null {
  const scan = (step: 1 | 2): string => {
    const pieces: string[] = []
    let total = 0
    let run = ''
    const flush = () => {
      if (run.length >= minRun) {
        pieces.push(run)
        total += run.length + 1
      }
      run = ''
    }
    for (let i = 0; i + step - 1 < b.length && total < cap; i += step) {
      const c = b[i]
      const printable = c >= 32 && c < 127 && (step === 1 || b[i + 1] === 0)
      if (printable) run += String.fromCharCode(c)
      else flush()
    }
    flush()
    return pieces.join('\n')
  }
  const wordCount = (s: string) => s.match(/[A-Za-z]{3,}/g)?.length ?? 0
  const ascii = scan(1)
  const utf16 = scan(2)
  // judge by real words, not raw length — binary junk can be letter-heavy
  const text = wordCount(utf16) > wordCount(ascii) ? utf16 : ascii
  return wordCount(text) >= 12 ? text : null
}

/** HTML → well-formed XHTML for foreignObject, with active content stripped. */
function toXhtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,link,iframe').forEach((el) => el.remove())
  const ser = new XMLSerializer()
  return Array.from(doc.body?.childNodes ?? [])
    .map((n) => ser.serializeToString(n))
    .join('')
}

/**
 * The page as a self-contained SVG data URL (foreignObject layout). Browsers
 * happily render this as an image source — going through a canvas instead
 * would taint it (foreignObject) and toDataURL would throw.
 */
function pageDataUrl(bodyXhtml: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}">` +
    `<foreignObject width="${PAGE_W}" height="${PAGE_H}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_W}px;height:${PAGE_H}px;` +
    `background:#ffffff;padding:60px;box-sizing:border-box;overflow:hidden;` +
    `font:15px/1.5 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#333;word-break:break-word">` +
    bodyXhtml +
    `</div></foreignObject></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/** First PDF page via lazy-loaded pdf.js, with its true aspect ratio. */
async function pdfPage(file: File): Promise<DocPreview | null> {
  try {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: PAGE_W / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, viewport }).promise
    const url = canvas.toDataURL('image/jpeg', 0.82)
    void task.destroy()
    return { image: url, aspect: base.width / base.height }
  } catch {
    return null
  }
}

/** Dev helper: a real playable 1s sine-wave WAV for testing the audio tile. */
export function makeDummyAudio(): File {
  const sampleRate = 8000
  const n = sampleRate
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  writeStr(36, 'data')
  v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 9) * 8000, true)
  return new File([buf], `dummy-audio-${Date.now() % 100000}.wav`, { type: 'audio/wav' })
}
