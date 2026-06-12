import { useRef, useState, type RefObject } from 'react'
import { useTheme } from '@freeappstore/sdk/hooks'
import { BuildInfo, Footer } from '@freeappstore/sdk/ui'
import { ThemeButton } from './components/ThemeButton'
import { EditProfileWindow } from './components/EditProfileWindow'
import { FloatingWindow } from './components/FloatingWindow'
import { IncomingShare } from './components/IncomingShare'
import { CloseIcon, UploadIcon, WebshareLogo } from './components/icons'
import { ProfileForm } from './components/ProfileForm'
import { useProfile } from './hooks/useProfile'
import { withThemeFade } from './lib/themeFade'
import { useShareRoom } from './hooks/useShareRoom'
import { mergeFiles, toFileMeta } from './lib/files'
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
  const { setPreference } = useTheme()

  const handleReset = () => {
    setEditing(false)
    setResetting(true)
    setTimeout(() => {
      // crossfade the bright↔dark swap instead of snapping
      withThemeFade(() => {
        reset()
        // a reset device starts fresh: theme follows the system again
        setPreference('system')
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
  const [navDragOver, setNavDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const pageAnimation = resetting
    ? 'ws-fade-out 380ms ease-in-out forwards'
    : justRegistered
      ? 'ws-page-in 380ms ease-in-out both'
      : 'none'

  return (
    <div
      className="flex min-h-dvh flex-col"
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
          // equal 1fr sides keep the middle cell viewport-centered at the same
          // width as the files column below it (max-w-2xl = 42rem)
          className="grid grid-cols-[1fr_minmax(0,42rem)_1fr] items-center gap-3 px-3 pt-3"
          style={{ animation: pageAnimation }}
        >
          <div className="flex items-center gap-2">
            <WebshareLogo />
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
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setNavDragOver(true)
              }}
              onDragLeave={() => setNavDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setNavDragOver(false)
                setFiles(mergeFiles(files, e.dataTransfer.files))
              }}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed px-4 py-2 text-[var(--muted)]"
              style={{
                borderColor: navDragOver ? 'var(--accent)' : 'var(--line-strong)',
                background: navDragOver ? 'var(--accent-gradient)' : 'var(--panel-quiet)',
              }}
            >
              <UploadIcon size={18} />
              <span className="text-sm font-semibold text-[var(--ink)] min-[560px]:hidden">Add files</span>
              <span className="hidden text-sm font-semibold text-[var(--ink)] min-[560px]:inline">
                Tap to add files
              </span>
              <span className="hidden text-xs min-[560px]:inline">or drag &amp; drop here</span>
            </button>
          ) : (
            <div />
          )}
          <div className="flex justify-end">
            <ThemeButton />
          </div>
        </header>
      )}

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
          page={page}
          setPage={setPage}
          files={files}
          setFiles={setFiles}
          fileInput={fileInput}
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
  page,
  setPage,
  files,
  setFiles,
  fileInput,
}: {
  profile: Profile
  animation: string
  onEditProfile: () => void
  page: 'files' | 'share'
  setPage: (page: 'files' | 'share') => void
  files: File[]
  setFiles: (files: File[]) => void
  fileInput: RefObject<HTMLInputElement | null>
}) {
  const room = useShareRoom(profile)

  const pickRecipient = (peer: PeerInfo) => {
    room.sendShareRequest(peer, files.map(toFileMeta))
  }

  return (
    <div
      className="flex flex-1 flex-col"
      // fades in on arrival; fades out during a profile reset
      style={{ animation }}
    >
      {page === 'files' ? (
        <FilesPage
          profile={profile}
          files={files}
          onFilesChange={setFiles}
          onShare={() => setPage('share')}
          onEditProfile={onEditProfile}
          inputRef={fileInput}
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
