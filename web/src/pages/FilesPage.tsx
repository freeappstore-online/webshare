import { useRef, useState } from 'react'
import { EditIcon, FileKindIcon, UploadIcon } from '../components/icons'
import { PeerAvatar } from '../components/PeerAvatar'
import { fileKind, formatBytes } from '../lib/files'
import type { Profile } from '../types'

interface FilesPageProps {
  profile: Profile
  files: File[]
  onFilesChange: (files: File[]) => void
  onShare: () => void
  onEditProfile: () => void
}

/** Main page: who you are, stage files to share, then pick a recipient. */
export function FilesPage({ profile, files, onFilesChange, onShare, onEditProfile }: FilesPageProps) {
  const input = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return
    // de-dupe by name+size so re-picking the same file doesn't double it
    const seen = new Set(files.map((f) => `${f.name}:${f.size}`))
    const fresh = [...incoming].filter((f) => !seen.has(`${f.name}:${f.size}`))
    if (fresh.length) onFilesChange([...files, ...fresh])
  }

  const removeAt = (i: number) => onFilesChange(files.filter((_, idx) => idx !== i))
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
      <div className="mb-5 flex flex-col items-center gap-3">
        <PeerAvatar pfp={profile.pfp} device={null} name={profile.name} size={128} />
        <p
          className="max-w-full truncate text-xl font-bold text-[var(--ink)]"
          style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em' }}
        >
          {profile.name}
        </p>
        <button
          onClick={onEditProfile}
          className="-mt-3 flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <EditIcon size={15} />
          Edit
        </button>
      </div>

      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <button
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          addFiles(e.dataTransfer.files)
        }}
        className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed p-6 text-[var(--muted)]"
        style={{
          borderColor: dragOver ? 'var(--accent)' : 'var(--line-strong)',
          background: dragOver ? 'var(--accent-gradient)' : 'var(--panel-quiet)',
        }}
      >
        <UploadIcon size={26} />
        <span className="text-sm font-semibold text-[var(--ink)]">Tap to add files</span>
        <span className="text-xs">or drag &amp; drop here</span>
      </button>

      {files.length === 0 ? (
        <div className="flex-1" />
      ) : (
        <>
          <div className="mt-4 flex items-baseline justify-between px-1">
            <h2 className="text-sm font-bold text-[var(--ink)]">
              {files.length} file{files.length === 1 ? '' : 's'}
            </h2>
            <span className="text-xs text-[var(--muted)]">{formatBytes(totalSize)}</span>
          </div>
          <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pb-24">
            {files.map((f, i) => (
              <li
                key={`${f.name}:${f.size}`}
                className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5"
              >
                <span className="text-[var(--accent)]">
                  <FileKindIcon kind={fileKind(f)} size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--ink)]">{f.name}</p>
                  <p className="text-xs text-[var(--muted)]">{formatBytes(f.size)}</p>
                </div>
                <button
                  onClick={() => removeAt(i)}
                  aria-label={`Remove ${f.name}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted)]"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {files.length > 0 && (
        <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-[var(--paper)] via-[var(--paper)] to-transparent px-4 pb-4 pt-6">
          <button
            onClick={onShare}
            className="flex min-h-13 w-full items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] font-bold text-white shadow-[var(--shadow-card)]"
          >
            Share {files.length} file{files.length === 1 ? '' : 's'} →
          </button>
        </div>
      )}
    </div>
  )
}
