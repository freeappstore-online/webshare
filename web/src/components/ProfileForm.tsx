import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@freeappstore/sdk/ui'
import { fileToPfp } from '../lib/image'
import type { Profile } from '../types'
import { InfoCircleIcon, PersonIcon, TrashIcon, WebshareLogo } from './icons'

const MAX_NAME = 24

interface ProfileFormProps {
  onSave: (profile: Profile) => Promise<void>
  /** Prefill for editing an existing profile. */
  initial?: Profile | null
  saveLabel: string
  /** When set, renders a header row with this title and the save button top-right (instead of a full-width bottom button). */
  title?: string
  /** No save buttons at all — valid changes are saved automatically (debounced). */
  autoSave?: boolean
  /** Focus the name input on mount (default true). Pass false to suppress the iOS keyboard pop-up when switching tabs. */
  autoFocus?: boolean
  onCancel?: () => void
}

/** Name + optional picture form, shared by first-run onboarding and the edit-profile window. */
export function ProfileForm({ onSave, initial, saveLabel, title, autoSave, autoFocus = true, onCancel }: ProfileFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [pfp, setPfp] = useState<string | null>(initial?.pfp ?? null)
  const [pfpError, setPfpError] = useState(false)
  const [saving, setSaving] = useState(false)
  // flips the title to a thank-you the moment save is clicked, and stays on
  // through the window's exit animation (it freezes the last open render)
  const [thanked, setThanked] = useState(false)
  // only nag about an empty name once the user has actually typed in the field
  const [nameTouched, setNameTouched] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const pickPfp = async (file: File | undefined) => {
    if (!file) return
    setPfpError(false)
    const data = await fileToPfp(file)
    if (data) setPfp(data)
    else setPfpError(true)
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setThanked(true)
    try {
      await onSave({ name: trimmed.slice(0, MAX_NAME), pfp })
    } catch (err) {
      setThanked(false)
      throw err
    } finally {
      setSaving(false)
    }
  }

  const saveDisabled = !name.trim() || saving

  // autoSave mode: persist valid changes shortly after the user stops typing
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  useEffect(() => {
    if (!autoSave) return
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed === initial?.name && pfp === (initial?.pfp ?? null)) return
    const timer = setTimeout(() => {
      void onSaveRef.current({ name: trimmed.slice(0, MAX_NAME), pfp })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, name, pfp])

  return (
    <div>
      {title && !autoSave && (
        // gap-4 matches the window's p-4, so the title never sits closer to
        // the button than the button sits to the right wall
        <div className="flex items-center justify-between gap-4">
          <h2 className="relative text-2xl font-bold tracking-tight text-[var(--ink)]">
            {/* the real title keeps reserving its space so the window height
                doesn't jump when the short thank-you swaps in over it */}
            <span className={thanked ? 'invisible' : undefined}>{title}</span>
            {thanked && <span className="absolute inset-0">Thanks!</span>}
          </h2>
          <button
            onClick={submit}
            disabled={saveDisabled}
            className="flex min-w-18 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {saving ? <Spinner size={16} color="#fff" /> : saveLabel}
          </button>
        </div>
      )}

      <div className="mt-5 flex flex-col items-center gap-3">
        <button
          onClick={() => fileInput.current?.click()}
          aria-label="Add profile picture"
          className="relative flex h-32 w-32 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-[var(--line-strong)] bg-[var(--paper-deep)] text-[var(--muted)]"
        >
          {pfp ? (
            <img src={pfp} alt="Profile preview" className="h-full w-full object-cover" />
          ) : (
            <PersonIcon size={68} />
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickPfp(e.target.files?.[0])}
        />
        <div className="flex gap-3 text-sm">
          <button
            onClick={() => fileInput.current?.click()}
            className="cursor-pointer font-semibold text-[var(--accent)]"
          >
            {pfp ? 'Change profile picture' : 'Add profile picture'}
          </button>
          {pfp && (
            <>
              <span aria-hidden="true" className="w-px self-stretch bg-[var(--line-strong)]" />
              <button
                onClick={() => setPfp(null)}
                className="flex cursor-pointer items-center gap-1 text-[var(--muted)]"
              >
                <TrashIcon size={14} />
                Remove
              </button>
            </>
          )}
        </div>
        {pfpError && (
          <p className="text-xs text-[var(--error)]">Couldn't use that image — try another one.</p>
        )}
      </div>

      {/* Apple-style floating label: rests as the placeholder, shrinks to the
          top-left when the field is focused or has a value */}
      <div className="relative mt-3">
        <input
          id="ws-profile-name"
          type="text"
          value={name}
          maxLength={MAX_NAME}
          autoFocus={autoFocus}
          placeholder=" "
          onChange={(e) => {
            setName(e.target.value)
            setNameTouched(true)
          }}
          onBlur={() => setNameTouched(true)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="peer w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--float-input-bg)] px-3 pb-1.5 pt-5 text-[var(--ink)] outline-none transition-shadow focus:border-[var(--sky)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--sky)_30%,transparent)]"
        />
        <label
          htmlFor="ws-profile-name"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] transition-all duration-200 peer-focus:top-1.5 peer-focus:translate-y-0 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs"
        >
          Your name
        </label>
      </div>

      {nameTouched && !name.trim() && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--error)]">
          <InfoCircleIcon size={14} />
          Please enter your name.
        </p>
      )}

      {!title && !autoSave && (
        <button
          onClick={submit}
          disabled={saveDisabled}
          className="mt-5 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] px-6 font-bold text-white disabled:opacity-40"
        >
          {saving ? <Spinner size={20} color="#fff" /> : saveLabel}
        </button>
      )}

      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-2 flex w-full cursor-pointer items-center justify-center rounded-[var(--radius)] py-1.5 font-semibold text-[var(--muted)]"
        >
          Cancel
        </button>
      )}

      {!initial && (
        <div className="mt-5 flex items-end justify-between gap-3">
          <p className="text-left text-xs leading-5 text-[var(--muted)]">
            Free · No sign-up · No tracking
            <br />
            Proudly a member of{' '}
            <a href="https://freeappstore.online" className="underline" target="_blank" rel="noreferrer">
              FreeAppStore
            </a>
          </p>
          <WebshareLogo alwaysText />
        </div>
      )}
    </div>
  )
}
