/**
 * Where received files get written.
 *
 * Chrome/Edge expose the File System Access API, so we ask the user to grant
 * access to a real folder (or file) and stream straight to disk — nothing is
 * held in memory, so a 20 GB movie works fine. Safari and Firefox have no such
 * API: there we buffer in memory and hand the browser a normal download at the
 * end (zipped when there's more than one file, so it's a single save prompt).
 *
 * Both pickers require a user gesture, so `pickSaveTarget` must be called
 * directly from a click handler — never after an `await`.
 */

interface FsWritable {
  write(data: BufferSource | Blob): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

interface FsFileHandle {
  name: string
  createWritable(opts?: { keepExistingData?: boolean }): Promise<FsWritable>
}

interface FsDirHandle {
  name: string
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>
}

type Picker = {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FsDirHandle>
  showSaveFilePicker?: (opts?: { suggestedName?: string; id?: string }) => Promise<FsFileHandle>
}

const picker = window as unknown as Picker

/** One open file being written to; `abort` discards a partially received file. */
export interface FileSink {
  write(chunk: ArrayBuffer): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export interface SaveTarget {
  /** Human-readable destination, shown when the transfer finishes. */
  readonly label: string
  /** Open the next incoming file for writing. */
  create(name: string): Promise<FileSink>
  /** All files received — flush anything still pending (the fallback's download). */
  finish(): Promise<void>
  /** Transfer aborted — drop whatever was buffered. */
  discard(): void
}

/** Strip path separators and other characters that can't be written to disk. */
function safeName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200)
  return cleaned || fallback
}

/** Streams directly into a user-granted folder. */
function directoryTarget(dir: FsDirHandle): SaveTarget {
  const used = new Set<string>()
  const written: string[] = []
  return {
    label: dir.name,
    async create(name) {
      // "photo.jpg" twice in one batch would clobber itself — suffix duplicates
      let final = safeName(name, 'file')
      if (used.has(final)) {
        const dot = final.lastIndexOf('.')
        const stem = dot > 0 ? final.slice(0, dot) : final
        const ext = dot > 0 ? final.slice(dot) : ''
        let n = 2
        while (used.has(`${stem} (${n})${ext}`)) n++
        final = `${stem} (${n})${ext}`
      }
      used.add(final)
      const handle = await dir.getFileHandle(final, { create: true })
      const writable = await handle.createWritable()
      return {
        write: (chunk) => writable.write(chunk),
        async close() {
          await writable.close()
          written.push(final)
        },
        async abort() {
          // leave no half-written file behind
          await writable.abort?.().catch(() => {})
          await dir.removeEntry(final).catch(() => {})
        },
      }
    },
    async finish() {},
    discard() {},
  }
}

/** Streams into the single file the user picked (used for one-file transfers). */
function singleFileTarget(handle: FsFileHandle): SaveTarget {
  return {
    label: handle.name,
    async create() {
      const writable = await handle.createWritable()
      return {
        write: (chunk) => writable.write(chunk),
        close: () => writable.close(),
        abort: async () => {
          await writable.abort?.().catch(() => {})
        },
      }
    },
    async finish() {},
    discard() {},
  }
}

/**
 * No File System Access API: collect blobs in memory, then trigger a download.
 * Several files are zipped so the user sees one save prompt instead of N.
 */
function memoryTarget(): SaveTarget {
  let files: { name: string; blob: Blob }[] = []
  return {
    label: 'your downloads',
    async create(name) {
      const parts: ArrayBuffer[] = []
      const final = safeName(name, 'file')
      return {
        async write(chunk) {
          parts.push(chunk)
        },
        async close() {
          files.push({ name: final, blob: new Blob(parts) })
          parts.length = 0
        },
        async abort() {
          parts.length = 0
        },
      }
    },
    async finish() {
      if (files.length === 0) return
      let blob: Blob
      let name: string
      if (files.length === 1) {
        blob = files[0].blob
        name = files[0].name
      } else {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        for (const f of files) zip.file(f.name, f.blob)
        blob = await zip.generateAsync({ type: 'blob' })
        name = `webshare-${files.length}-items.zip`
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Safari needs the object URL alive until the download actually starts
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      files = []
    },
    discard() {
      files = []
    },
  }
}

/** True when the browser can hand us a real save location to stream into. */
export const canPickLocation =
  typeof picker.showDirectoryPicker === 'function' || typeof picker.showSaveFilePicker === 'function'

/**
 * Ask the user where to put `count` incoming files. Must be called synchronously
 * from a click handler.
 *
 * Returns `null` when the user dismissed the picker (they changed their mind —
 * the caller should stay on the accept prompt rather than start a transfer).
 */
export async function pickSaveTarget(count: number, firstName: string): Promise<SaveTarget | null> {
  try {
    if (count === 1 && picker.showSaveFilePicker) {
      return singleFileTarget(
        await picker.showSaveFilePicker({ suggestedName: safeName(firstName, 'file'), id: 'webshare' })
      )
    }
    if (picker.showDirectoryPicker) {
      return directoryTarget(await picker.showDirectoryPicker({ mode: 'readwrite', id: 'webshare' }))
    }
  } catch (err) {
    // AbortError = user closed the picker. A SecurityError means the gesture
    // was already spent, and NotAllowedError means permission was denied —
    // in both cases fall back rather than dead-ending the transfer.
    if ((err as DOMException)?.name === 'AbortError') return null
  }
  return memoryTarget()
}
