import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTheme } from '@freeappstore/sdk/hooks'
import { BuildInfo, Footer } from '@freeappstore/sdk/ui'
import { ThemeButton } from './components/ThemeButton'
import { EditProfileWindow } from './components/EditProfileWindow'
import { FloatingWindow } from './components/FloatingWindow'
import { IncomingShare } from './components/IncomingShare'
import { CloseIcon, FolderToFilesIcon, TriangleInfoIcon, UploadIcon, WebshareLogo } from './components/icons'
import { ProfileForm } from './components/ProfileForm'
import { useProfile } from './hooks/useProfile'
import { withThemeFade } from './lib/themeFade'
import { useShareRoom } from './hooks/useShareRoom'
import { mergeFiles, readEntry, toFileMeta } from './lib/files'
import { FilesPage } from './pages/FilesPage'
import { SharePage } from './pages/SharePage'
import type { PeerInfo, Profile } from './types'

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
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  useEffect(() => { setAddPickerOpen(false) }, [files.length])

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
      {/* no nav bar — logo top-left, theme toggle top-right; hidden until first-run setup is done */}
      {profile && (
        <header
          // the middle cell mirrors the files column below it: same 42rem cap,
          // and at md+ the 16rem sides equal the page's profile column (14rem)
          // + gap (2rem), so button and list edges line up at every width
          className="grid grid-cols-[1fr_minmax(0,42rem)_1fr] items-center gap-3 px-3 pt-3 min-[680px]:grid-cols-[minmax(16rem,1fr)_minmax(0,42rem)_minmax(3rem,1fr)] min-[680px]:gap-0 min-[680px]:px-4"
          style={{ animation: pageAnimation }}
        >
          <div className="flex items-center gap-2">
            <WebshareLogo alwaysText={files.length === 0} />
            <button
              onClick={() => setAboutOpen(true)}
              className="cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              About
            </button>
          </div>
          {/* slim version of the empty-state dropzone, same width as the file list */}
          {page === 'files' && files.length > 0 ? (
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
          <div className="flex justify-end">
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
            Use drag &amp; drop to add folders containing more than 1,000 files
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
          <WebshareLogo />
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
}) {
  const room = useShareRoom(profile)

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
        />
      ) : (
        <SharePage
          fileCount={files.length}
          peers={room.peers}
          connection={room.connection}
          outgoing={room.outgoing}
          onPick={pickRecipient}
          onClearOutgoing={room.clearOutgoing}
          onBack={() => setPage('files')}
        />
      )}
      <IncomingShare request={room.incoming} onRespond={room.respondToShare} />
    </div>
  )
}
