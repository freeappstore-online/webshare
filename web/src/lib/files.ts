import type { FileKind, FileMeta } from '../types'

// prettier-ignore
const AUDIO_EXTS = new Set([
  '3gp', 'aa', 'aac', 'aax', 'act', 'aiff', 'alac', 'amr', 'ape', 'au', 'awb',
  'dss', 'dvf', 'flac', 'gsm', 'iklax', 'ivs', 'm4a', 'm4b', 'm4p', 'mmf',
  'movpkg', 'mp1', 'mp2', 'mp3', 'mpc', 'msv', 'nmf', 'ogg', 'oga', 'mogg',
  'opus', 'ra', 'rm', 'raw', 'rf64', 'sln', 'tta', 'voc', 'vox', 'wav', 'wma',
  'wv', 'webm', '8svx', 'cda',
])

// prettier-ignore
const VIDEO_EXTS = new Set([
  '3g2', '3gp', 'amv', 'asf', 'avi', 'drc', 'f4a', 'f4b', 'f4p', 'f4v', 'flv',
  'gifv', 'm2ts', 'm2v', 'm4p', 'm4v', 'mju', 'mkv', 'mng', 'mov', 'mp2',
  'mp4', 'mpe', 'mpeg', 'mpg', 'mts', 'mxf', 'nsv', 'ogg', 'ogv', 'qt', 'rm',
  'rmvb', 'roq', 'svi', 'ts', 'vob', 'webm', 'wmv', 'yuv',
])

/** A file inside a staged folder, with its path relative to that folder's root. */
export interface FolderEntry {
  file: File
  /** e.g. "photos/trip/a.jpg" — no leading slash, never empty */
  path: string
}

/**
 * A staged folder shows as a single icon, but it has to carry its contents so
 * it can actually be sent. Keeping them beside the placeholder (rather than
 * flattening thousands of files into the staging list) is what lets the files
 * page stay one-icon-per-folder while the transfer still gets everything.
 */
const folderContents = new WeakMap<File, { entries: FolderEntry[]; bytes: number }>()

export function makeFolderItem(name: string, entries: FolderEntry[] = []): File {
  const item = new File([], name, { type: 'application/x-directory' })
  folderContents.set(item, {
    entries,
    bytes: entries.reduce((n, e) => n + e.file.size, 0),
  })
  return item
}

/** Contents of a staged folder, or null if this isn't one. */
export function folderInfo(file: File): { entries: FolderEntry[]; bytes: number } | null {
  return folderContents.get(file) ?? null
}

/**
 * Flatten what's staged into the files that actually go over the wire, each
 * with the path it should be written to on the other side. Folders contribute
 * their whole subtree; everything else keeps its bare name.
 */
export function expandForTransfer(items: File[]): FolderEntry[] {
  const out: FolderEntry[] = []
  for (const item of items) {
    const info = folderContents.get(item)
    if (info) {
      for (const e of info.entries) out.push({ file: e.file, path: `${item.name}/${e.path}` })
    } else if (item.type !== 'application/x-directory') {
      out.push({ file: item, path: item.name })
    }
  }
  return out
}


export function fileKind(file: File): FileKind {
  const t = file.type
  if (t === 'application/x-directory') return 'folder'
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (/zip|tar|rar|7z|gzip|compressed/.test(t)) return 'archive'
  if (/pdf|text|document|msword|spreadsheet|presentation|json|xml|csv/.test(t)) return 'doc'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  // extensions in both lists (3gp, mp2, ogg, webm, …) classify as audio; the
  // thumbnail pipeline still tries a video frame for them afterwards
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'archive'
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext)) return 'doc'
  return 'other'
}

export const fileKey = (f: File) => `${f.name}:${f.size}`

/** Uppercase extension for icon labels ("archive.dmg" → "DMG"); null if none. */
export function fileExt(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1)
  return ext.length >= 1 && ext.length <= 5 ? ext.toUpperCase() : null
}

/** Append incoming files, de-duped by name+size; returns `existing` untouched if nothing new. */
export function mergeFiles(existing: File[], incoming: FileList | File[] | null): File[] {
  if (!incoming?.length) return existing
  const seen = new Set(existing.map(fileKey))
  const fresh = [...incoming].filter((f) => !seen.has(fileKey(f)))
  return fresh.length ? [...existing, ...fresh] : existing
}

export function toFileMeta(file: File): FileMeta {
  // keep extension visible when truncating long names
  let n = file.name
  if (n.length > 40) {
    const dot = n.lastIndexOf('.')
    const ext = dot > 0 && n.length - dot <= 8 ? n.slice(dot) : ''
    n = n.slice(0, 40 - ext.length - 1) + '…' + ext
  }
  // a folder's placeholder is 0 bytes; report what it actually contains
  const info = folderInfo(file)
  return { n, s: info ? info.bytes : file.size, k: fileKind(file) }
}

const entryFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((res, rej) => entry.file(res, rej))

/**
 * Walk a dropped directory. `readEntries` only hands back a batch at a time
 * (Chrome caps it at 100) and returns empty when exhausted, so it has to be
 * called in a loop — and we yield between batches so a deep tree doesn't lock
 * up the page while it's being read.
 */
async function readDirectory(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  out: FolderEntry[]
): Promise<void> {
  const reader = dir.createReader()
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
      reader.readEntries(res, rej)
    )
    if (batch.length === 0) break
    for (const child of batch) {
      if (child.isFile) {
        out.push({ file: await entryFile(child as FileSystemFileEntry), path: prefix + child.name })
      } else if (child.isDirectory) {
        await readDirectory(child as FileSystemDirectoryEntry, `${prefix}${child.name}/`, out)
      }
    }
    await new Promise((r) => setTimeout(r, 0))
  }
}

export async function readEntry(
  entry: FileSystemEntry,
  onFile: (file: File) => void
): Promise<void> {
  if (entry.isFile) {
    onFile(await entryFile(entry as FileSystemFileEntry))
    return
  }
  if (entry.isDirectory) {
    // One icon for the whole directory, but its contents ride along so the
    // folder can actually be transferred.
    const entries: FolderEntry[] = []
    await readDirectory(entry as FileSystemDirectoryEntry, '', entries)
    onFile(makeFolderItem(entry.name, entries))
  }
}

/** Read a DataTransfer, recursively expanding any dropped directories. */
export async function readDroppedItems(
  transfer: DataTransfer,
  onFile: (file: File) => void
): Promise<void> {
  const entries: FileSystemEntry[] = []
  for (let i = 0; i < transfer.items.length; i++) {
    const entry = transfer.items[i].webkitGetAsEntry()
    if (entry) entries.push(entry)
  }
  if (!entries.length) {
    for (const f of transfer.files) onFile(f)
    return
  }
  await Promise.all(entries.map((e) => readEntry(e, onFile)))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
