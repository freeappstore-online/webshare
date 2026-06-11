import type { FileKind, FileMeta } from '../types'

export function fileKind(file: File): FileKind {
  const t = file.type
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (/zip|tar|rar|7z|gzip|compressed/.test(t)) return 'archive'
  if (/pdf|text|document|msword|spreadsheet|presentation|json|xml|csv/.test(t)) return 'doc'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'archive'
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext)) return 'doc'
  return 'other'
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
