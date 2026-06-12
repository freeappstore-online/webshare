import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Dropdown } from '../components/Dropdown'
import {
  EditIcon,
  FileKindIcon,
  UploadIcon,
  ViewColumnsIcon,
  ViewGalleryIcon,
  ViewIconsIcon,
  ViewListIcon,
} from '../components/icons'
import { PeerAvatar } from '../components/PeerAvatar'
import { fileKey, fileKind, formatBytes, mergeFiles } from '../lib/files'
import type { Profile } from '../types'

interface FilesPageProps {
  profile: Profile
  files: File[]
  onFilesChange: (files: File[]) => void
  onShare: () => void
  onEditProfile: () => void
  /** owned by App so the nav bar's add-files button can open the picker */
  inputRef: RefObject<HTMLInputElement | null>
}

type ViewMode = 'icons' | 'list' | 'columns' | 'gallery'

const VIEW_KEY = 'webshare:view'
const PER_ROW_KEY = 'webshare:perRow'

const VIEWS: Array<{ key: ViewMode; label: string; Icon: typeof ViewListIcon }> = [
  { key: 'icons', label: 'Icons', Icon: ViewIconsIcon },
  { key: 'list', label: 'List', Icon: ViewListIcon },
  { key: 'columns', label: 'Columns', Icon: ViewColumnsIcon },
  { key: 'gallery', label: 'Gallery', Icon: ViewGalleryIcon },
]

/** Main page: who you are, stage files to share, then pick a recipient. */
export function FilesPage({ profile, files, onFilesChange, onShare, onEditProfile, inputRef: input }: FilesPageProps) {
  const [dragOver, setDragOver] = useState(false)
  const [view, setView] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(VIEW_KEY)
    return stored === 'icons' || stored === 'list' || stored === 'columns' || stored === 'gallery'
      ? stored
      : 'list'
  })
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [perRow, setPerRow] = useState(() => {
    const n = Number(localStorage.getItem(PER_ROW_KEY))
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 3
  })

  const pickView = (mode: ViewMode) => {
    setView(mode)
    localStorage.setItem(VIEW_KEY, mode)
  }

  const pickPerRow = (n: number) => {
    setPerRow(n)
    localStorage.setItem(PER_ROW_KEY, String(n))
  }

  // thumbnails for image files (icons + gallery views)
  const thumbs = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of files) {
      if (f.type.startsWith('image/')) map.set(fileKey(f), URL.createObjectURL(f))
    }
    return map
  }, [files])
  useEffect(() => {
    return () => {
      for (const url of thumbs.values()) URL.revokeObjectURL(url)
    }
  }, [thumbs])

  const addFiles = (incoming: FileList | null) => {
    const next = mergeFiles(files, incoming)
    if (next !== files) onFilesChange(next)
  }

  const removeAt = (i: number) => onFilesChange(files.filter((_, idx) => idx !== i))
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  const current = Math.min(galleryIndex, files.length - 1)

  const removeButton = (i: number, name: string, size = 'h-11 w-11') => (
    <button
      onClick={(e) => {
        e.stopPropagation()
        removeAt(i)
      }}
      aria-label={`Remove ${name}`}
      className={`flex ${size} shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--line-strong)] hover:text-[var(--ink)]`}
    >
      ✕
    </button>
  )

  const hasFiles = files.length > 0

  return (
    <div className={`mx-auto flex w-full flex-1 flex-col p-4 ${hasFiles ? '' : 'max-w-2xl'}`}>
      {/* once files are staged on a wide screen, profile docks left and files get the room */}
      <div className={`flex min-h-0 flex-1 flex-col ${hasFiles ? 'md:flex-row md:items-start md:gap-8' : ''}`}>
      <div
        className={`mb-5 flex flex-col items-center gap-3 ${
          hasFiles ? 'md:sticky md:top-6 md:w-56 md:shrink-0' : ''
        }`}
      >
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

      <div
        className={`flex min-h-0 w-full flex-1 flex-col ${hasFiles ? 'md:mx-auto md:max-w-2xl' : ''}`}
        onDragOver={hasFiles ? (e) => e.preventDefault() : undefined}
        onDrop={
          hasFiles
            ? (e) => {
                e.preventDefault()
                addFiles(e.dataTransfer.files)
              }
            : undefined
        }
      >
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

      {/* big dropzone only while empty; once files are staged it shrinks into the toolbar */}
      {!hasFiles && (
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
          className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed p-6 text-[var(--muted)]"
          style={{
            borderColor: dragOver ? 'var(--accent)' : 'var(--line-strong)',
            background: dragOver ? 'var(--accent-gradient)' : 'var(--panel-quiet)',
          }}
        >
          <UploadIcon size={26} />
          <span className="text-sm font-semibold text-[var(--ink)]">Tap to add files</span>
          <span className="text-xs">or drag &amp; drop here</span>
        </button>
      )}

      {files.length === 0 ? (
        <div className="flex-1" />
      ) : (
        <>
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold text-[var(--ink)]">
              {files.length} file{files.length === 1 ? '' : 's'}
              <span className="ml-2 text-xs font-medium text-[var(--muted)]">
                {formatBytes(totalSize)}
              </span>
            </h2>
            <div className="flex items-center gap-3">
            {view === 'icons' && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]">
                Files per row:
                <Dropdown
                  value={perRow}
                  options={Array.from({ length: 10 }, (_, i) => i + 1)}
                  onChange={pickPerRow}
                  ariaLabel="Files per row"
                />
              </span>
            )}
            {/* macOS Finder-style segmented view switcher: gray track, raised active chip */}
            <div className="flex rounded-[0.5rem] bg-[var(--float-pill-bg)] p-0.5">
              {VIEWS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => pickView(key)}
                  aria-label={`${label} view`}
                  title={label}
                  className="flex h-7 w-9 cursor-pointer items-center justify-center rounded-[0.4rem] transition-colors"
                  style={
                    view === key
                      ? {
                          background: 'var(--float-pill-active)',
                          color: 'var(--ink)',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.18)',
                        }
                      : { color: 'var(--muted)' }
                  }
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
            </div>
          </div>

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pb-24">
            {view === 'list' && (
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li
                    key={fileKey(f)}
                    className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5"
                  >
                    <span className="text-[var(--accent)]">
                      <FileKindIcon kind={fileKind(f)} size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--ink)]">{f.name}</p>
                      <p className="text-xs text-[var(--muted)]">{formatBytes(f.size)}</p>
                    </div>
                    {removeButton(i, f.name)}
                  </li>
                ))}
              </ul>
            )}

            {view === 'icons' && (
              <ul
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
              >
                {/* square tile frame; icon or preview is contained inside, never cropped */}
                {files.map((f, i) => (
                  <li key={fileKey(f)} className="relative flex flex-col items-center gap-1 p-2">
                    <span className="absolute -right-1 -top-1 z-10">{removeButton(i, f.name, 'h-7 w-7 text-xs')}</span>
                    <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--panel)] p-2">
                      {thumbs.get(fileKey(f)) ? (
                        <img
                          src={thumbs.get(fileKey(f))}
                          alt=""
                          className="max-h-full max-w-full rounded-[3px] object-contain shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
                        />
                      ) : (
                        <span className="text-[var(--accent)]">
                          <FileKindIcon kind={fileKind(f)} size={40} />
                        </span>
                      )}
                    </span>
                    <FinderFileName name={f.name} />
                  </li>
                ))}
              </ul>
            )}

            {view === 'columns' && (
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
                {files.map((f, i) => (
                  <li
                    key={fileKey(f)}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--panel)] py-1 pl-2.5 pr-1"
                  >
                    <span className="shrink-0 text-[var(--accent)]">
                      <FileKindIcon kind={fileKind(f)} size={15} />
                    </span>
                    <p className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--ink)]" title={f.name}>
                      {f.name}
                    </p>
                    {removeButton(i, f.name, 'h-7 w-7 text-xs')}
                  </li>
                ))}
              </ul>
            )}

            {view === 'gallery' && current >= 0 && (
              <div className="flex flex-col gap-3">
                {/* big preview of the selected file */}
                <div className="relative flex min-h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4">
                  <span className="absolute right-2 top-2">
                    {removeButton(current, files[current].name, 'h-8 w-8 text-sm')}
                  </span>
                  {thumbs.get(fileKey(files[current])) ? (
                    <img
                      src={thumbs.get(fileKey(files[current]))}
                      alt={files[current].name}
                      className="max-h-56 rounded-[var(--radius-sm)] object-contain"
                    />
                  ) : (
                    <span className="text-[var(--accent)]">
                      <FileKindIcon kind={fileKind(files[current])} size={72} />
                    </span>
                  )}
                  <p className="max-w-full truncate text-sm font-semibold text-[var(--ink)]">
                    {files[current].name}
                  </p>
                  <p className="-mt-1.5 text-xs text-[var(--muted)]">{formatBytes(files[current].size)}</p>
                </div>
                {/* filmstrip */}
                <ul className="flex gap-2 overflow-x-auto pb-1">
                  {files.map((f, i) => (
                    <li key={fileKey(f)} className="shrink-0">
                      <button
                        onClick={() => setGalleryIndex(i)}
                        aria-label={f.name}
                        title={f.name}
                        className="flex h-14 w-auto min-w-14 max-w-28 cursor-pointer items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border bg-[var(--panel)]"
                        style={{
                          borderColor: i === current ? 'var(--accent)' : 'var(--line)',
                          borderWidth: i === current ? 2 : 1,
                        }}
                      >
                        {thumbs.get(fileKey(f)) ? (
                          // Finder-style strip: tile width follows the media's aspect ratio
                          <img src={thumbs.get(fileKey(f))} alt="" className="h-full w-auto object-contain" />
                        ) : (
                          <span className="text-[var(--accent)]">
                            <FileKindIcon kind={fileKind(f)} size={22} />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
      </div>
      {/* mirrors the profile column so the files section sits centered */}
      {hasFiles && <div className="hidden md:block md:w-56 md:shrink-0" />}
      </div>

      {files.length > 0 && (
        <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-[var(--paper)] via-[var(--paper)] to-transparent px-4 pb-4 pt-6">
          <button
            onClick={onShare}
            className="mx-auto flex min-h-13 w-full max-w-2xl cursor-pointer items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] font-bold text-white shadow-[var(--shadow-card)]"
          >
            Share {files.length} file{files.length === 1 ? '' : 's'} →
          </button>
        </div>
      )}
    </div>
  )
}

// shared canvas for text measurement (cheap, no DOM thrash)
let measureCanvas: CanvasRenderingContext2D | null = null
function getMeasureCtx(font: string): CanvasRenderingContext2D {
  if (!measureCanvas) measureCanvas = document.createElement('canvas').getContext('2d')!
  measureCanvas.font = font
  return measureCanvas
}

/**
 * Finder-style file label: wraps to at most two lines based on the tile's
 * actual width. When the name is too long, the second line is middle-ellipsized
 * so the ending (extension + last characters) stays visible, e.g.
 * "aaaaaaaaaaaaaaaaaaaa…" / "aaaaaa…456.pdf".
 */
function FinderFileName({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<[string, string]>([name, ''])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const compute = () => {
      const width = el.clientWidth - 1
      if (width <= 0) return
      const style = getComputedStyle(el)
      const ctx = getMeasureCtx(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
      const fits = (s: string) => ctx.measureText(s).width <= width

      if (fits(name)) {
        setLines([name, ''])
        return
      }
      // line 1: the longest prefix that fits the tile width
      let lo = 0
      let hi = name.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(name.slice(0, mid))) lo = mid
        else hi = mid - 1
      }
      const line1 = name.slice(0, lo)
      const rest = name.slice(lo)
      if (fits(rest)) {
        setLines([line1, rest])
        return
      }
      // line 2: middle-ellipsize, always keeping the tail visible
      const tailLen = Math.min(7, rest.length - 1)
      const tail = rest.slice(-tailLen)
      let lo2 = 0
      let hi2 = rest.length - tailLen
      const fits2 = (n: number) => fits(rest.slice(0, n) + '…' + tail)
      while (lo2 < hi2) {
        const mid = Math.ceil((lo2 + hi2) / 2)
        if (fits2(mid)) lo2 = mid
        else hi2 = mid - 1
      }
      setLines([line1, rest.slice(0, lo2) + '…' + tail])
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [name])

  return (
    <div
      ref={ref}
      className="w-full text-center text-xs font-semibold leading-tight text-[var(--ink)]"
      title={name}
    >
      <div className="overflow-hidden whitespace-nowrap">{lines[0]}</div>
      {lines[1] && <div className="overflow-hidden whitespace-nowrap">{lines[1]}</div>}
    </div>
  )
}
