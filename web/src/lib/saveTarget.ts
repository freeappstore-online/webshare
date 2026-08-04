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

import { crc32Blob } from './crc32'

interface FsWritable {
  write(
    data: BufferSource | Blob | { type: 'write'; position: number; data: BufferSource }
  ): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

interface FsFileHandle {
  name: string
  createWritable(opts?: { keepExistingData?: boolean }): Promise<FsWritable>
  getFile(): Promise<File>
}

interface FsDirHandle {
  name: string
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>
}

type Picker = {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FsDirHandle>
  showSaveFilePicker?: (opts?: { suggestedName?: string; id?: string }) => Promise<FsFileHandle>
}

const picker = window as unknown as Picker

/**
 * One open file being written to.
 *
 * Writes carry an explicit position because chunks travel unordered — a lost
 * packet must not hold up the ones behind it, so they can land in any order.
 */
export interface FileSink {
  write(chunk: ArrayBuffer, position: number): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export interface SaveTarget {
  /** Human-readable destination, shown when the transfer finishes. */
  readonly label: string
  /** Open the next incoming file for writing; `size` is its final length. */
  create(name: string, size: number): Promise<FileSink>
  /** All files received — flush anything still pending (the fallback's download). */
  finish(): Promise<void>
  /** Transfer aborted — drop whatever was buffered. */
  discard(): void
  /**
   * CRC32 of a file as it now exists, or null if this target can't read back.
   * Reading from the destination rather than from memory is the point: it
   * verifies what was actually stored, so a bad offset or a failed write is
   * caught rather than assumed away.
   */
  checksum(path: string): Promise<number | null>
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

/**
 * Split an incoming "folder/sub/file.ext" into sanitised segments.
 *
 * The path comes from the peer, so it's untrusted: `..` and absolute paths
 * have to be neutralised or a sender could write outside the folder the user
 * picked. Sanitising each segment separately (rather than the whole string)
 * keeps the directory structure while making traversal impossible.
 */
function safeSegments(path: string): { dirs: string[]; name: string } {
  const parts = path
    .split('/')
    .filter((p) => p !== '' && p !== '.' && p !== '..')
    .map((p) => safeName(p, 'item'))
  const name = parts.pop() ?? 'file'
  // don't let a pathological path nest forever
  return { dirs: parts.slice(0, 32), name }
}

/** Streams directly into a user-granted folder, recreating any subfolders. */
function directoryTarget(dir: FsDirHandle): SaveTarget {
  const used = new Set<string>()
  const written = new Map<string, FsFileHandle>()
  return {
    label: dir.name,
    async create(path) {
      const { dirs, name } = safeSegments(path)
      // walk (creating as needed) down to the file's own directory
      let parent = dir
      for (const segment of dirs) {
        parent = await parent.getDirectoryHandle(segment, { create: true })
      }

      // "photo.jpg" twice in the same directory would clobber itself
      const key = [...dirs, name].join('/')
      let final = name
      if (used.has(key)) {
        const dot = name.lastIndexOf('.')
        const stem = dot > 0 ? name.slice(0, dot) : name
        const ext = dot > 0 ? name.slice(dot) : ''
        let n = 2
        while (used.has([...dirs, `${stem} (${n})${ext}`].join('/'))) n++
        final = `${stem} (${n})${ext}`
      }
      used.add([...dirs, final].join('/'))

      const handle = await parent.getFileHandle(final, { create: true })
      written.set(path, handle)
      const writable = await handle.createWritable()
      const owner = parent
      return {
        write: (chunk, position) => writable.write({ type: 'write', position, data: chunk }),
        close: () => writable.close(),
        async abort() {
          // leave no half-written file behind
          await writable.abort?.().catch(() => {})
          await owner.removeEntry(final).catch(() => {})
        },
      }
    },
    async finish() {},
    discard() {},
    async checksum(path) {
      const handle = written.get(path)
      if (!handle) return null
      return crc32Blob(await handle.getFile())
    },
  }
}

/** Streams into the single file the user picked (used for one-file transfers). */
function singleFileTarget(handle: FsFileHandle): SaveTarget {
  return {
    label: handle.name,
    async create() {
      const writable = await handle.createWritable()
      return {
        write: (chunk, position) => writable.write({ type: 'write', position, data: chunk }),
        close: () => writable.close(),
        abort: async () => {
          await writable.abort?.().catch(() => {})
        },
      }
    },
    async finish() {},
    discard() {},
    async checksum() {
      return crc32Blob(await handle.getFile())
    },
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
    async create(path, size) {
      // chunks arrive in any order, so lay them into one buffer by position
      const whole = new Uint8Array(size)
      const { dirs, name } = safeSegments(path)
      // JSZip builds the directories from the entry name
      const final = [...dirs, name].join('/')
      return {
        async write(chunk, position) {
          whole.set(new Uint8Array(chunk), position)
        },
        async close() {
          files.push({ name: final, blob: new Blob([whole]) })
        },
        async abort() {},
      }
    },
    async finish() {
      if (files.length === 0) return
      let blob: Blob
      let name: string
      // a lone file goes down as itself — but anything with structure has to
      // be zipped, or the folder layout is lost
      if (files.length === 1 && !files[0].name.includes('/')) {
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
    async checksum(path) {
      const { dirs, name } = safeSegments(path)
      const key = [...dirs, name].join('/')
      const found = files.find((f) => f.name === key)
      return found ? crc32Blob(found.blob) : null
    },
  }
}

/** True when the browser can hand us a real save location to stream into. */
export const canPickLocation =
  typeof picker.showDirectoryPicker === 'function' || typeof picker.showSaveFilePicker === 'function'

/**
 * Ask the user where to put `count` incoming items. Must be called
 * synchronously from a click handler.
 *
 * `hasFolder` forces the directory picker: a folder is one item but many files
 * with a structure to rebuild, which a single save-file handle can't express.
 *
 * Returns `null` when the user dismissed the picker (they changed their mind —
 * the caller should stay on the accept prompt rather than start a transfer).
 */
export async function pickSaveTarget(
  count: number,
  firstName: string,
  hasFolder = false
): Promise<SaveTarget | null> {
  try {
    if (count === 1 && !hasFolder && picker.showSaveFilePicker) {
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
