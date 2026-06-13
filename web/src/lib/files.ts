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

export function makeFolderItem(name: string): File {
  return new File([], name, { type: 'application/x-directory' })
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
  return { n, s: file.size, k: fileKind(file) }
}

export async function readEntry(
  entry: FileSystemEntry,
  onFile: (file: File) => void
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej),
    )
    onFile(file)
    return
  }
  if (entry.isDirectory) {
    // Represent the whole directory as a single folder icon — no recursion,
    // no filesystem reads, no freezing.
    onFile(makeFolderItem(entry.name))
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
