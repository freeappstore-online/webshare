import { useEffect, useRef, useState, type RefObject } from 'react'
import { Dropdown } from '../components/Dropdown'
import {
  AudioSquareIcon,
  CheckIcon,
  EditIcon,
  FolderIcon,
  PaperIcon,
  UploadIcon,
  ViewIconsIcon,
  ViewListIcon,
} from '../components/icons'
import { PeerAvatar } from '../components/PeerAvatar'
import { fileExt, fileKey, fileKind, makeFolderItem } from '../lib/files'
import { docPreview, fileThumb, type DocPreview } from '../lib/thumbs'
import type { Profile } from '../types'

interface FilesPageProps {
  profile: Profile
  files: File[]
  onFilesChange: (files: File[]) => void
  onAddFiles: (files: FileList | File[] | null) => void
  onShare: () => void
  onEditProfile: () => void
  onOpenAddPicker: () => void
  /** owned by App so the nav bar's add-files button can open the picker */
  inputRef: RefObject<HTMLInputElement | null>
  /** owned by App so the nav bar's add-folder button can open the picker */
  folderInputRef: RefObject<HTMLInputElement | null>
  /** drag detection is full-screen (window listeners in App) */
  dragOver: boolean
}

type ViewMode = 'icons' | 'list'

const VIEW_KEY = 'webshare:view'
const PER_ROW_KEY = 'webshare:perRow'
const LIST_ICON_SIZE_KEY = 'webshare:listIconSize'

type ListIconSize = 'small' | 'medium' | 'big'
const LIST_ICON_PX: Record<ListIconSize, number> = { small: 22, medium: 44, big: 80 }

const VIEWS: Array<{ key: ViewMode; label: string; Icon: typeof ViewListIcon }> = [
  { key: 'icons', label: 'Icons', Icon: ViewIconsIcon },
  { key: 'list', label: 'List', Icon: ViewListIcon },
]

/** Main page: who you are, stage files to share, then pick a recipient. */
export function FilesPage({ profile, files, onFilesChange, onAddFiles, onShare, onEditProfile, onOpenAddPicker, inputRef: input, folderInputRef: folderInput, dragOver }: FilesPageProps) {
  const [view, setView] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(VIEW_KEY)
    return stored === 'icons' || stored === 'list' ? stored : 'icons'
  })
  const [perRow, setPerRow] = useState(() => {
    const n = Number(localStorage.getItem(PER_ROW_KEY))
    return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 3
  })
  const [listIconSize, setListIconSize] = useState<ListIconSize>(() => {
    const s = localStorage.getItem(LIST_ICON_SIZE_KEY)
    return s === 'small' || s === 'medium' || s === 'big' ? s : 'medium'
  })
  const pickListIconSize = (s: ListIconSize) => {
    setListIconSize(s)
    localStorage.setItem(LIST_ICON_SIZE_KEY, s)
  }

  // first files of a batch pick a sensible grid density automatically:
  // desktop 2/3/4 files → that many per row (capped at 5); mobile 2 or 3
  const prevCount = useRef(files.length)
  useEffect(() => {
    if (prevCount.current === 0 && files.length > 0) {
      const mobile = window.matchMedia('(max-width: 767px)').matches
      const n = files.length
      setPerRow(mobile ? (n >= 3 ? 3 : 2) : Math.min(Math.max(n, 2), 5))
    }
    prevCount.current = files.length
  }, [files.length])

  const pickView = (mode: ViewMode) => {
    setView(mode)
    localStorage.setItem(VIEW_KEY, mode)
  }

  const pickPerRow = (n: number) => {
    setPerRow(n)
    localStorage.setItem(PER_ROW_KEY, String(n))
  }

  // previews: images directly, first frame for videos, embedded album art
  // for audio — generated async, cached per file, dropped on removal
  const [thumbs, setThumbs] = useState<Map<string, string | null>>(new Map())
  const [texts, setTexts] = useState<Map<string, DocPreview>>(new Map())
  const requested = useRef(new Set<string>())
  useEffect(() => {
    const keys = new Set(files.map(fileKey))
    setThumbs((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [k, url] of prev) {
        if (!keys.has(k)) {
          if (url) URL.revokeObjectURL(url)
          next.delete(k)
          requested.current.delete(k)
          changed = true
        }
      }
      return changed ? next : prev
    })
    setTexts((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const k of prev.keys()) {
        if (!keys.has(k)) {
          next.delete(k)
          changed = true
        }
      }
      return changed ? next : prev
    })
    for (const f of files) {
      const k = fileKey(f)
      if (requested.current.has(k)) continue
      requested.current.add(k)
      void fileThumb(f).then((url) => {
        setThumbs((prev) => {
          if (!requested.current.has(k)) {
            if (url) URL.revokeObjectURL(url)
            return prev
          }
          return new Map(prev).set(k, url)
        })
      })
      // document files: rendered page snapshot shown on the paper icon
      void docPreview(f).then((doc) => {
        if (doc) setTexts((prev) => (prev.has(k) ? prev : new Map(prev).set(k, doc)))
      })
    }
  }, [files])

  // selection mode (Select button next to the file count)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleSelectMode = () => {
    setSelectMode(!selectMode)
    setSelected(new Set())
  }

  // Rubber-band (marquee) selection — mouse only
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [rubberBand, setRubberBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const rbWasInSelectMode = useRef(false)
  const rbModifier = useRef(false)       // Ctrl/Cmd held at drag start
  const rbBaseSelection = useRef(new Set<string>()) // selection snapshot at drag start

  const onContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    if ((e.target as Element).closest('li, button, input, [role="listbox"]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    document.body.classList.add('ws-rubber-banding')
    rbWasInSelectMode.current = selectMode
    rbModifier.current = e.metaKey || e.ctrlKey
    rbBaseSelection.current = rbModifier.current ? new Set(selected) : new Set()
    setRubberBand({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY })
  }

  const onContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rubberBand) return
    const band = { ...rubberBand, x2: e.clientX, y2: e.clientY }
    setRubberBand(band)
    const minX = Math.min(band.x1, band.x2)
    const maxX = Math.max(band.x1, band.x2)
    const minY = Math.min(band.y1, band.y2)
    const maxY = Math.max(band.y1, band.y2)
    const inBand = new Set<string>()
    scrollContainerRef.current?.querySelectorAll<HTMLElement>('li[data-key]').forEach((li) => {
      const r = li.getBoundingClientRect()
      if (r.right >= minX && r.left <= maxX && r.bottom >= minY && r.top <= maxY) inBand.add(li.dataset.key!)
    })
    const next = rbModifier.current
      ? new Set([...rbBaseSelection.current, ...inBand])
      : inBand
    if (next.size > 0 && !selectMode) setSelectMode(true)
    setSelected(next)
  }

  const onContainerPointerUp = () => {
    document.body.classList.remove('ws-rubber-banding')
    if (!rubberBand) return
    if (!rbModifier.current) {
      const dx = Math.abs(rubberBand.x2 - rubberBand.x1)
      const dy = Math.abs(rubberBand.y2 - rubberBand.y1)
      if (dx < 5 && dy < 5 || selected.size === 0) {
        setSelectMode(false)
        setSelected(new Set())
      }
    }
    setRubberBand(null)
  }

  const handleItemClick = (key: string) => {
    if (!selectMode) {
      setSelectMode(true)
      setSelected(new Set([key]))
      return
    }
    const next = new Set(selected)
    if (next.has(key)) {
      next.delete(key)
      if (next.size === 0) setSelectMode(false)
    } else {
      next.add(key)
    }
    setSelected(next)
  }

  // iOS Photos-style: hollow white ring with a soft shadow; fills accent when picked
  const selectCircle = (key: string) => (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 shadow-[0_1px_4px_rgba(0,0,0,0.35),inset_0_1px_4px_rgba(0,0,0,0.35)] ${
        selected.has(key) ? 'border-white bg-[var(--accent)] text-white' : 'border-white bg-transparent'
      }`}
    >
      {selected.has(key) && <CheckIcon size={16} className="translate-y-[1px]" />}
    </span>
  )

  const selectedFileCount = files.filter(f => selected.has(fileKey(f)) && fileKind(f) !== 'folder').length
  const selectedFolderCount = files.filter(f => selected.has(fileKey(f)) && fileKind(f) === 'folder').length
  const selectLabel = (() => {
    const parts = []
    if (selectedFileCount > 0) parts.push(`${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''}`)
    if (selectedFolderCount > 0) parts.push(`${selectedFolderCount} folder${selectedFolderCount !== 1 ? 's' : ''}`)
    return parts.length ? parts.join(', ') : '0 selected'
  })()

  const removeSelected = () => {
    const remaining = files.filter((f) => !selected.has(fileKey(f)))
    onFilesChange(remaining)
    setSelected(new Set())
    setSelectMode(false)
  }

  const hasFiles = files.length > 0

  return (
    <div
      className={`mx-auto flex min-h-0 w-full flex-1 flex-col p-4 ${hasFiles ? '' : 'max-w-2xl'}`}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
    >
      {/* once files are staged on a wide screen, profile docks left and files get the room */}
      <div className={`flex min-h-0 flex-1 flex-col ${hasFiles ? 'min-[680px]:grid min-[680px]:grid-cols-[minmax(16rem,1fr)_minmax(0,42rem)_minmax(0,1fr)] min-[680px]:gap-0' : ''}`}>
      <div
        className={`flex flex-col items-center ${
          hasFiles
            ? 'mb-1 min-[680px]:mb-5 gap-1.5 min-[680px]:gap-3 min-[680px]:sticky min-[680px]:top-6 min-[680px]:self-start'
            : 'mb-5 gap-3'
        }`}
      >
        {hasFiles && <span className="min-[680px]:hidden"><PeerAvatar pfp={profile.pfp} device={null} name={profile.name} size={100} /></span>}
        <span className={hasFiles ? 'hidden min-[680px]:inline' : ''}><PeerAvatar pfp={profile.pfp} device={null} name={profile.name} size={128} /></span>
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

      <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${hasFiles ? 'w-full mx-auto' : ''}`}>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onAddFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          const first = e.target.files?.[0]
          if (first) {
            const folderName = first.webkitRelativePath?.split('/')[0] || first.name
            onAddFiles([makeFolderItem(folderName)])
          }
          e.target.value = ''
        }}
      />

      {/* big dropzone only while empty; once files are staged it shrinks into the toolbar */}
      {!hasFiles && (
        <button
          onClick={onOpenAddPicker}
          className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed p-6 text-[var(--muted)] transition-none"
          style={{
            borderColor: dragOver ? 'var(--accent)' : 'var(--line-strong)',
            background: dragOver ? 'var(--accent-gradient)' : 'var(--paper-deep)',
          }}
        >
          <UploadIcon size={26} />
          <span className="text-sm font-semibold text-[var(--ink)]">Add files…</span>
          <span className="text-xs">or drag &amp; drop here</span>
        </button>
      )}

      {files.length === 0 ? (
        <div className="flex-1" />
      ) : (
        <>
          {/* min-h matches the pill switcher so swapping to select-mode buttons doesn't change row height */}
          <div className="flex h-11 items-center justify-between px-1 min-[480px]:h-9">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 className="min-w-0 text-sm font-bold text-[var(--ink)]">
                <span className="flex flex-col min-[420px]:flex-row min-[420px]:items-baseline min-[420px]:gap-2">
                  <span>
                    {selectMode
                      ? selectLabel
                      : `${files.length} item${files.length === 1 ? '' : 's'}`}
                  </span>
                </span>
              </h2>
              <button
                onClick={toggleSelectMode}
                className="cursor-pointer rounded-[0.4rem] border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm font-semibold text-[var(--ink)] transition-none hover:bg-[var(--line-strong)] min-[480px]:px-2.5 min-[480px]:py-1.5 min-[480px]:text-xs"
              >
                {selectMode ? 'Done' : 'Select'}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
            {selectMode ? (
              <>
                <button
                  onClick={() => {
                    if (selected.size === files.length) {
                      setSelected(new Set())
                    } else {
                      setSelected(new Set(files.map(fileKey)))
                    }
                  }}
                  className="cursor-pointer rounded-[0.4rem] border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm font-semibold text-[var(--ink)] transition-none hover:bg-[var(--line-strong)] min-[480px]:px-2.5 min-[480px]:py-1.5 min-[480px]:text-xs"
                >
                  {selected.size === files.length ? 'Unselect All' : 'Select All'}
                </button>
                <button
                  onClick={removeSelected}
                  disabled={selected.size === 0}
                  className="cursor-pointer rounded-[0.4rem] border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm font-semibold text-[var(--error)] transition-none hover:bg-[var(--line-strong)] disabled:cursor-default disabled:opacity-40 min-[480px]:px-2.5 min-[480px]:py-1.5 min-[480px]:text-xs"
                >
                  Remove
                </button>
              </>
            ) : (
              <>
                {view === 'icons' && (
                  <Dropdown
                    value={perRow}
                    options={Array.from({ length: 8 }, (_, i) => ({ value: i + 1, label: `${i + 1} per row` }))}
                    onChange={pickPerRow}
                    ariaLabel="Files per row"
                    trigger={<><span>{perRow}</span><span className="hidden min-[400px]:inline"> per row</span></>}
                  />
                )}
                {view === 'list' && (
                  <Dropdown
                    value={listIconSize}
                    options={[
                      { value: 'small' as const, label: <><span className="min-[370px]:hidden">Small</span><span className="hidden min-[370px]:inline">Small icon</span></> },
                      { value: 'medium' as const, label: <><span className="min-[370px]:hidden">Medium</span><span className="hidden min-[370px]:inline">Medium icon</span></> },
                      { value: 'big' as const, label: <><span className="min-[370px]:hidden">Big</span><span className="hidden min-[370px]:inline">Big icon</span></> },
                    ]}
                    onChange={pickListIconSize}
                    ariaLabel="List icon size"
                    trigger={<><span>{{ small: 'Small', medium: 'Medium', big: 'Big' }[listIconSize]}</span><span className="hidden min-[430px]:inline"> icon</span></>}
                  />
                )}
                {/* same pill tabs as the edit-profile window: sliding chip behind the active option */}
                <div className="relative flex rounded-full bg-[var(--page-pill-bg)] p-1">
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 top-1 w-11 rounded-full transition-transform duration-200 ease-out min-[480px]:w-9"
                    style={{
                      background: 'var(--page-pill-active)',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                      transform: `translateX(${VIEWS.findIndex((v) => v.key === view) * 100}%)`,
                    }}
                  />
                  {VIEWS.map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => pickView(key)}
                      aria-label={`${label} view`}
                      title={label}
                      className={`relative z-10 flex h-9 w-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 min-[480px]:h-7 min-[480px]:w-9 ${
                        view === key ? 'text-[var(--ink)]' : 'text-[var(--muted)]'
                      }`}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                </div>
              </>
            )}
            </div>
          </div>

          <div
            ref={scrollContainerRef}
            className="ws-scroll mt-2 min-h-0 flex-1 overflow-y-auto pb-6"
          >
            {view === 'list' && (
              <ul>
                {files.map((f) => (
                  <li
                    key={fileKey(f)}
                    data-key={fileKey(f)}
                    onClick={() => handleItemClick(fileKey(f))}
                    className={`select-none relative flex items-center gap-3 px-1 py-2.5 cursor-pointer rounded-[var(--radius-sm)] [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:content-[''] [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[var(--sep-left)] [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-[var(--line-strong)] ${selected.has(fileKey(f)) ? 'bg-[var(--select-frame-bg)]' : ''}`}
                    style={{ '--sep-left': selectMode ? `${4 + 24 + 12 + LIST_ICON_PX[listIconSize] + 12}px` : `${4 + LIST_ICON_PX[listIconSize] + 12}px` } as React.CSSProperties}
                  >
                    {selectMode && selectCircle(fileKey(f))}
                    <span className="text-[var(--accent)]">
                      {fileKind(f) === 'folder' ? (
                        <FolderIcon size={LIST_ICON_PX[listIconSize]} />
                      ) : fileKind(f) === 'audio' ? (
                        <AudioSquareIcon art={thumbs.get(fileKey(f)) ?? undefined} size={LIST_ICON_PX[listIconSize]} />
                      ) : (
                        <PaperIcon label={fileExt(f.name) ?? undefined} preview={texts.get(fileKey(f))?.image} previewText={texts.get(fileKey(f))?.text} aspect={texts.get(fileKey(f))?.aspect} size={LIST_ICON_PX[listIconSize]} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="ws-list-file-info flex min-w-0 flex-col">
                        <ListFileName name={f.name} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {view === 'icons' && (
              <ul
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
              >
                {/* ticked tiles get one merged frame around icon + name (bg on the li) */}
                {files.map((f) => (
                  <li
                    key={fileKey(f)}
                    data-key={fileKey(f)}
                    onClick={() => handleItemClick(fileKey(f))}
                    className={`select-none relative flex flex-col items-center gap-1 rounded-[var(--radius-sm)] p-2 cursor-pointer  ${selected.has(fileKey(f)) ? 'bg-[var(--select-frame-bg)]' : ''}`}
                  >
                    <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] p-1">
                      {fileKind(f) === 'folder' ? (
                        <span className="flex h-full w-full items-center justify-center text-[var(--accent)]">
                          <FolderIcon className="h-full w-full" />
                        </span>
                      ) : thumbs.get(fileKey(f)) && fileKind(f) !== 'audio' && fileKind(f) !== 'doc' ? (
                        <img
                          src={thumbs.get(fileKey(f))!}
                          alt=""
                          className="max-h-full max-w-full rounded-[3px] object-contain shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[var(--accent)]">
                          {thumbs.get(fileKey(f)) !== undefined && fileKind(f) === 'audio' ? (
                            <AudioSquareIcon art={thumbs.get(fileKey(f)) ?? undefined} className="h-full w-full" />
                          ) : (
                            <PaperIcon label={fileExt(f.name) ?? undefined} preview={texts.get(fileKey(f))?.image} previewText={texts.get(fileKey(f))?.text} aspect={texts.get(fileKey(f))?.aspect} className="h-full w-full" />
                          )}
                        </span>
                      )}
                      {selectMode && (
                        <span className="absolute inset-x-0 bottom-2 flex justify-center">
                          {selectCircle(fileKey(f))}
                        </span>
                      )}
                    </span>
                    <span className="w-full px-1">
                      <FinderFileName name={f.name} />
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {rubberBand && (
              <div
                style={{
                  position: 'fixed',
                  left: Math.min(rubberBand.x1, rubberBand.x2),
                  top: Math.min(rubberBand.y1, rubberBand.y2),
                  width: Math.abs(rubberBand.x2 - rubberBand.x1),
                  height: Math.abs(rubberBand.y2 - rubberBand.y1),
                  background: 'var(--rubber-band-bg)',
                  border: '1.5px solid var(--rubber-band-border)',
                  borderRadius: 4,
                  pointerEvents: 'none',
                  zIndex: 50,
                }}
              />
            )}
          </div>
        </>
      )}
      </div>
      {hasFiles && <div className="hidden min-[680px]:block" />}
      </div>

      {files.length > 0 && (
        <div
          className="sticky bottom-0 -mx-4 px-4 min-[680px]:grid min-[680px]:grid-cols-[minmax(16rem,1fr)_minmax(0,42rem)_minmax(0,1fr)] min-[680px]:gap-0"
        >
          <div className="hidden min-[680px]:block" />
          <div className="relative mx-auto w-full max-w-2xl bg-[var(--bg-end)]">
            <div className="pointer-events-none absolute bottom-full left-0 right-0 h-4" style={{ background: 'linear-gradient(to bottom, transparent, var(--bg-end))' }} />
            <button
              onClick={onShare}
              className="flex w-full cursor-pointer items-center justify-center rounded-full bg-[var(--accent)] py-2 font-bold text-white"
            >
              {selectMode && selected.size > 0
                ? `Share ${selected.size} selected item${selected.size === 1 ? '' : 's'}`
                : `Share ${files.length} item${files.length === 1 ? '' : 's'}`}
            </button>
          </div>
          <div className="hidden min-[680px]:block" />
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
      // line 2: middle-ellipsize, keeping 4 chars + extension visible
      const dot = name.lastIndexOf('.')
      const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ''
      const tailLen = Math.min(4 + ext.length, rest.length - 1)
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
      className="select-text w-full text-center text-xs font-semibold leading-tight text-[var(--ink)]"
      title={name}
    >
      <div className="overflow-hidden whitespace-nowrap">{lines[0]}</div>
      {lines[1] && <div className="overflow-hidden whitespace-nowrap">{lines[1]}</div>}
    </div>
  )
}

/** List-view filename: single line, middle-ellipsized keeping the tail visible. */
function ListFileName({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [display, setDisplay] = useState(name)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const compute = () => {
      const width = el.clientWidth - 1
      if (width <= 0) return
      const style = getComputedStyle(el)
      const ctx = getMeasureCtx(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
      const fits = (s: string) => ctx.measureText(s).width <= width
      if (fits(name)) { setDisplay(name); return }
      const dot = name.lastIndexOf('.')
      const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ''
      const tailLen = Math.min(4 + ext.length, name.length - 1)
      const tail = name.slice(-tailLen)
      let lo = 0, hi = name.length - tailLen
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(name.slice(0, mid) + '…' + tail)) lo = mid
        else hi = mid - 1
      }
      setDisplay(name.slice(0, lo) + '…' + tail)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [name])

  return (
    <div ref={ref} className="select-text w-full text-sm font-semibold text-[var(--ink)]" title={name}>
      <div className="overflow-hidden whitespace-nowrap">{display}</div>
    </div>
  )
}
