import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTheme } from '@freeappstore/sdk/hooks'
import { BuildInfo, Footer } from '@freeappstore/sdk/ui'
import { ThemeButton } from './components/ThemeButton'
import { EditProfileWindow } from './components/EditProfileWindow'
import { FloatingWindow } from './components/FloatingWindow'
import { IncomingShare } from './components/IncomingShare'
import { Dropdown } from './components/Dropdown'
import { CloseIcon, FolderToFilesIcon, TriangleInfoIcon, UploadIcon, ViewIconsIcon, ViewListIcon, WebshareLogo } from './components/icons'
import { ProfileForm } from './components/ProfileForm'
import { useProfile } from './hooks/useProfile'
import { withThemeFade } from './lib/themeFade'
import { useShareRoom } from './hooks/useShareRoom'
import { mergeFiles, readEntry, toFileMeta } from './lib/files'
import { FilesPage } from './pages/FilesPage'
import { SharePage } from './pages/SharePage'
import type { PeerInfo, Profile } from './types'

type ViewMode = 'icons' | 'list'
type ListIconSize = 'small' | 'medium' | 'big'
const SHARE_VIEW_KEY = 'webshare:share:view'
const SHARE_PER_ROW_KEY = 'webshare:share:perRow'
const SHARE_LIST_ICON_KEY = 'webshare:share:listIconSize'

function getDefaultSharePerRow(width: number): number {
  if (width < 460) return 3
  if (width < 600) return 4
  if (width < 680) return 5
  if (width < 780) return 3
  if (width < 960) return 4
  return 5
}

const SHARE_VIEWS = [
  { key: 'icons' as const, label: 'Icons', Icon: ViewIconsIcon },
  { key: 'list' as const, label: 'List', Icon: ViewListIcon },
]

export default function App() {
  const { profile, save, reset } = useProfile()
  const [editing, setEditing] = useState(false)
  // reset choreography: fade everything out first, then clear the profile so
  // the welcome window can fade in on a clean page
  const [resetting, setResetting] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [addPickerOpen, setAddPickerOpen] = useState(false)
  const { setPreference } = useTheme()

  const handleReset = () => {
    setEditing(false)
    setResetting(true)
    setTimeout(() => {
      // crossfade the bright↔dark swap instead of snapping
      withThemeFade(() => {
        reset()
        setPreference('system')
        setFiles([])
        fileQueue.current = []
        setPage('files')
        localStorage.removeItem('webshare:view')
        localStorage.removeItem('webshare:perRow')
        localStorage.removeItem('webshare:listIconSize')
        setShareView('icons')
        setSharePerRowUser(null)
        setShareListIconSize('medium')
        localStorage.removeItem(SHARE_VIEW_KEY)
        localStorage.removeItem(SHARE_PER_ROW_KEY)
        localStorage.removeItem(SHARE_LIST_ICON_KEY)
        setResetting(false)
      })
    }, 400)
  }

  // fade-in is reserved for the registration handoff (welcome → main); a plain
  // refresh with an existing profile renders instantly
  const [justRegistered, setJustRegistered] = useState(false)

  // staged files live here so the nav bar can host the add-files button;
  // the hidden file input itself renders inside FilesPage
  const [page, setPage] = useState<'files' | 'share'>('files')
  const [discoverable, setDiscoverable] = useState(false)

  const [shareView, setShareView] = useState<ViewMode>(() => {
    const s = localStorage.getItem(SHARE_VIEW_KEY)
    return s === 'icons' || s === 'list' ? s : 'icons'
  })
  const [sharePerRowUser, setSharePerRowUser] = useState<number | null>(() => {
    const n = Number(localStorage.getItem(SHARE_PER_ROW_KEY))
    return Number.isInteger(n) && n >= 1 && n <= 8 ? n : null
  })
  const [sharePerRowViewport, setSharePerRowViewport] = useState(() => getDefaultSharePerRow(window.innerWidth))
  const [shareListIconSize, setShareListIconSize] = useState<ListIconSize>(() => {
    const s = localStorage.getItem(SHARE_LIST_ICON_KEY)
    return s === 'small' || s === 'medium' || s === 'big' ? s : 'medium'
  })
  const sharePerRow = sharePerRowUser ?? sharePerRowViewport
  const pickShareView = (mode: ViewMode) => { setShareView(mode); localStorage.setItem(SHARE_VIEW_KEY, mode) }
  const pickSharePerRow = (n: number) => { setSharePerRowUser(n); localStorage.setItem(SHARE_PER_ROW_KEY, String(n)) }
  const pickShareListIconSize = (s: ListIconSize) => { setShareListIconSize(s); localStorage.setItem(SHARE_LIST_ICON_KEY, s) }

  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  useEffect(() => { setAddPickerOpen(false) }, [files.length])
  useEffect(() => {
    const onResize = () => setSharePerRowViewport(getDefaultSharePerRow(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // A continuous queue so dropping giant folders doesn't lock the thread.
  // Pushes happen instantly; rendering yields to the browser every 150 files.
  const fileQueue = useRef<File[]>([])
  const processing = useRef(false)

  const processQueue = () => {
    if (fileQueue.current.length === 0) {
      processing.current = false
      return
    }
    const chunk = fileQueue.current.splice(0, 150)
    setFiles((prev) => mergeFiles(prev, chunk))
    // Yield to browser rendering (roughly 1 frame) before doing the next chunk
    setTimeout(processQueue, 16)
  }

  const addFilesBatched = (incoming: FileList | File[] | null) => {
    if (!incoming || !incoming.length) return
    setPage('files') // Switch page immediately for instant visual feedback
    const arr = incoming instanceof FileList ? Array.from(incoming) : incoming
    fileQueue.current.push(...arr)
    if (!processing.current) {
      processing.current = true
      processQueue()
    }
  }

  // Absorb the two-finger swipe-back gesture while files are staged.
  // The WebSocket prevents bfcache, so navigating away loses all File objects.
  // Pushing a dummy history entry means popstate fires instead of a real navigation.
  useEffect(() => {
    if (files.length === 0) return
    history.pushState(null, '')
    const onPopState = () => history.pushState(null, '')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [files.length > 0])

  // full-screen drop target: files dragged anywhere onto the page get added —
  // but only while the files page is actually in front (not during welcome /
  // register, not behind the edit-profile window, not on the share page).
  // The browser default (opening the dropped file in the tab) is always blocked.
  const dropActive = !!profile && !editing && page === 'files'
  useEffect(() => {
    const isFileDrag = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      if (dropActive) setDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      // relatedTarget is null when the drag exits the window
      if (!e.relatedTarget) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      setDragOver(false)
      if (!dropActive) return

      // Snap to the files page immediately to give the user visual confirmation
      setPage('files')

      // Collect entries synchronously (items list is invalidated after yield)
      const items = e.dataTransfer!.items
      const entries: FileSystemEntry[] = []
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry()
        if (entry) entries.push(entry)
      }
      if (!entries.length) {
        addFilesBatched([...e.dataTransfer!.files])
        return
      }
      // Stream: push files into the queue the exact millisecond they are
      // discovered in the directory tree without waiting for the whole folder.
      void (async () => {
        await Promise.all(entries.map(entry =>
          readEntry(entry, (file) => {
            fileQueue.current.push(file)
            if (!processing.current) {
              processing.current = true
              processQueue()
            }
          })
        ))
      })()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [dropActive])

  const pageAnimation = resetting
    ? 'ws-fade-out 380ms ease-in-out forwards'
    : justRegistered
      ? 'ws-page-in 380ms ease-in-out both'
      : 'none'

  return (
    <div
      // hard viewport cap: long file lists scroll inside the page, not the window
      className="flex h-dvh flex-col overflow-hidden"
      // gray page during first-run welcome (light mode only), eases back after setup.
      // the ease only runs around registration/reset — a manual theme toggle
      // should swap colors instantly, not fade
      style={{
        backgroundColor: profile ? 'transparent' : 'var(--welcome-bg)',
        transition:
          !profile || resetting || justRegistered ? 'background-color 380ms ease-in-out' : 'none',
      }}
    >
      {profile && (
        <header
          className="grid grid-cols-[1fr_minmax(0,42rem)_1fr] items-center gap-3 px-3 pt-3 min-[680px]:grid-cols-[minmax(16rem,1fr)_minmax(0,42rem)_minmax(3rem,1fr)] min-[680px]:gap-0 min-[680px]:px-4"
          style={{ animation: pageAnimation }}
        >
          <div className="flex items-center gap-2">
            <WebshareLogo alwaysText={files.length === 0 || page === 'share'} />
            <button
              onClick={() => setAboutOpen(true)}
              className="cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              About
            </button>
          </div>

          {page === 'share' && files.length > 0 ? (
            <div className="hidden min-[680px]:flex w-full min-w-0 items-center gap-2">
              <p className="flex-1 min-w-0 truncate text-sm font-bold text-[var(--ink)]">
                {shareView === 'icons' ? (
                  <>
                    <span className="min-[720px]:hidden">Tap to send {files.length} item{files.length !== 1 ? 's' : ''}</span>
                    <span className="hidden min-[720px]:inline">Tap people to send {files.length} item{files.length !== 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <>
                    <span className="min-[750px]:hidden">Tap to send {files.length} item{files.length !== 1 ? 's' : ''}</span>
                    <span className="hidden min-[750px]:inline">Tap people to send {files.length} item{files.length !== 1 ? 's' : ''}</span>
                  </>
                )}
              </p>
              {shareView === 'icons' && (
                <Dropdown
                  value={sharePerRow}
                  options={Array.from({ length: 8 }, (_, i) => ({ value: i + 1, label: `${i + 1} per row` }))}
                  onChange={pickSharePerRow}
                  ariaLabel="Recipients per row"
                  trigger={<><span>{sharePerRow}</span><span className="hidden min-[400px]:inline"> per row</span></>}
                />
              )}
              {shareView === 'list' && (
                <Dropdown
                  value={shareListIconSize}
                  options={[
                    { value: 'small' as const, label: 'Small icon' },
                    { value: 'medium' as const, label: 'Medium icon' },
                    { value: 'big' as const, label: 'Big icon' },
                  ]}
                  onChange={pickShareListIconSize}
                  ariaLabel="Avatar size"
                  trigger={<><span>{{ small: 'Small', medium: 'Medium', big: 'Big' }[shareListIconSize]}</span><span className="hidden min-[430px]:inline"> icon</span></>}
                />
              )}
              <div className="relative flex shrink-0 rounded-full bg-[var(--page-pill-bg)] p-1">
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 top-1 w-11 rounded-full transition-transform duration-200 ease-out"
                  style={{
                    background: 'var(--page-pill-active)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                    transform: `translateX(${SHARE_VIEWS.findIndex((v) => v.key === shareView) * 100}%)`,
                  }}
                />
                {SHARE_VIEWS.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    onClick={() => pickShareView(key)}
                    aria-label={`${label} view`}
                    title={label}
                    className={`relative z-10 flex h-9 w-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 ${
                      shareView === key ? 'text-[var(--ink)]' : 'text-[var(--muted)]'
                    }`}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : page === 'files' && files.length > 0 ? (
            <button
              onClick={() => setAddPickerOpen(true)}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed px-4 py-2 text-[var(--muted)] transition-none"
              style={{
                borderColor: dragOver ? 'var(--accent)' : 'var(--line-strong)',
                background: dragOver ? 'var(--accent-gradient)' : 'var(--paper-deep)',
              }}
            >
              <span className="hidden min-[320px]:contents"><UploadIcon size={18} /></span>
              <span className="text-sm font-semibold text-[var(--ink)] min-[320px]:hidden">Add files</span>
              <span className="hidden text-sm font-semibold text-[var(--ink)] min-[320px]:inline">Add files…</span>
              <span className="hidden text-xs min-[540px]:inline">or drag &amp; drop here</span>
            </button>
          ) : (
            <div />
          )}

          <div className="col-start-3 flex justify-end">
            <ThemeButton />
          </div>
        </header>
      )}

      <FloatingWindow open={addPickerOpen} closeOnBackdrop onClose={() => setAddPickerOpen(false)}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3">
            <button
              onClick={() => fileInput.current?.click()}
              className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed py-2.5 px-6 text-[var(--muted)] transition-none"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--paper-deep)' }}
            >
              <UploadIcon size={26} />
              <span className="text-sm font-semibold text-[var(--ink)]">Add files</span>
            </button>
            <button
              onClick={() => folderInput.current?.click()}
              className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed py-2.5 px-6 text-[var(--muted)] transition-none"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--paper-deep)' }}
            >
              <FolderToFilesIcon size={26} />
              <span className="text-sm font-semibold text-[var(--ink)]">Add files from a folder</span>
            </button>
          </div>
          <p className="flex items-center gap-1.5 px-1 text-xs opacity-55 text-[var(--ink)]">
            <TriangleInfoIcon size={18} className="shrink-0" />
            Use drag &amp; drop to add folders having more than 1,000 files
          </p>
          <button
            onClick={() => setAddPickerOpen(false)}
            aria-label="Cancel"
            className="flex cursor-pointer items-center justify-center self-center rounded-full p-2 text-[var(--muted)] transition-colors hover:bg-[var(--line-strong)] hover:text-[var(--ink)]"
          >
            <CloseIcon size={20} />
          </button>
        </div>
      </FloatingWindow>
      <FloatingWindow open={aboutOpen} closeOnBackdrop onClose={() => setAboutOpen(false)}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <WebshareLogo alwaysText />
          <p className="text-sm text-[var(--muted)]">
            Share files with people on your network — like AirDrop, but in the browser.
          </p>
          <p className="text-xs text-[var(--muted)]">
            Free · No sign-up · No tracking
            <br />
            Proudly a member of{' '}
            <a href="https://freeappstore.online" className="underline" target="_blank" rel="noreferrer">
              FreeAppStore
            </a>
          </p>
          <button
            onClick={() => setAboutOpen(false)}
            aria-label="Close about"
            className="-mb-2.5 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-[var(--ink)] transition-colors hover:bg-[var(--line-strong)]"
          >
            <CloseIcon size={20} />
          </button>
        </div>
      </FloatingWindow>
      {profile && (
        <Main
          profile={profile}
          animation={pageAnimation}
          onEditProfile={() => setEditing(true)}
          onOpenAddPicker={() => setAddPickerOpen(true)}
          onAddFiles={addFilesBatched}
          page={page}
          setPage={setPage}
          files={files}
          setFiles={setFiles}
          fileInput={fileInput}
          folderInput={folderInput}
          dragOver={dragOver}
          shareView={shareView}
          sharePerRow={sharePerRow}
          shareListIconSize={shareListIconSize}
          onShareViewChange={pickShareView}
          onSharePerRowChange={pickSharePerRow}
          onShareListIconSizeChange={pickShareListIconSize}
          discoverable={discoverable}
          onDiscoverableChange={setDiscoverable}
        />
      )}

      {/* one floating window for both first-run welcome (alone on the page, no dim)
          and edit profile (dimmed over the main page) */}
      <FloatingWindow
        open={!profile || editing}
        dim={!!profile}
        closeOnBackdrop={!!profile}
        onClose={() => setEditing(false)}
      >
        {profile ? (
          <EditProfileWindow
            profile={profile}
            onSave={save}
            onReset={handleReset}
            onClose={() => setEditing(false)}
          />
        ) : (
          <ProfileForm
            initial={null}
            title="Hi! What should we call you?"
            saveLabel="Continue"
            onSave={async (p) => {
              // flag first: it must land in the same commit as the profile so
              // the bg transition is already active when the color swaps
              setJustRegistered(true)
              await save(p)
            }}
          />
        )}
      </FloatingWindow>

      <BuildInfo />
      {/* safe-area spacer, only renders when installed as a PWA */}
      <Footer />
    </div>
  )
}

function Main({
  profile,
  animation,
  onEditProfile,
  onOpenAddPicker,
  onAddFiles,
  page,
  setPage,
  files,
  setFiles,
  fileInput,
  folderInput,
  dragOver,
  shareView,
  sharePerRow,
  shareListIconSize,
  onShareViewChange,
  onSharePerRowChange,
  onShareListIconSizeChange,
  discoverable,
  onDiscoverableChange,
}: {
  profile: Profile
  animation: string
  onEditProfile: () => void
  onOpenAddPicker: () => void
  onAddFiles: (files: FileList | File[] | null) => void
  page: 'files' | 'share'
  setPage: (page: 'files' | 'share') => void
  files: File[]
  setFiles: (files: File[]) => void
  fileInput: RefObject<HTMLInputElement | null>
  folderInput: RefObject<HTMLInputElement | null>
  dragOver: boolean
  shareView: ViewMode
  sharePerRow: number
  shareListIconSize: ListIconSize
  onShareViewChange: (mode: ViewMode) => void
  onSharePerRowChange: (n: number) => void
  onShareListIconSizeChange: (s: ListIconSize) => void
  discoverable: boolean
  onDiscoverableChange: (v: boolean) => void
}) {
  const room = useShareRoom(profile, discoverable)

  const pickRecipient = (peer: PeerInfo) => {
    room.sendShareRequest(peer, files.map(toFileMeta))
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      // fades in on arrival; fades out during a profile reset
      style={{ animation }}
    >
      {page === 'files' ? (
        <FilesPage
          profile={profile}
          files={files}
          onFilesChange={setFiles}
          onAddFiles={onAddFiles}
          onShare={() => setPage('share')}
          onEditProfile={onEditProfile}
          onOpenAddPicker={onOpenAddPicker}
          inputRef={fileInput}
          folderInputRef={folderInput}
          dragOver={dragOver}
          discoverable={discoverable}
          onDiscoverableChange={onDiscoverableChange}
        />
      ) : (
        <SharePage
          profile={profile}
          fileCount={files.length}
          view={shareView}
          perRow={sharePerRow}
          listIconSize={shareListIconSize}
          onViewChange={onShareViewChange}
          onPerRowChange={onSharePerRowChange}
          onListIconSizeChange={onShareListIconSizeChange}
          peers={room.peers}
          connection={room.connection}
          outgoing={room.outgoing}
          onPick={pickRecipient}
          onBack={() => setPage('files')}
        />
      )}
      <IncomingShare request={room.incoming} onRespond={room.respondToShare} />
    </div>
  )
}
