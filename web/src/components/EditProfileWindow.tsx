import { useState } from 'react'
import type { Profile } from '../types'
import { CloseIcon } from './icons'
import { ProfileForm } from './ProfileForm'

interface EditProfileWindowProps {
  profile: Profile
  onSave: (p: Profile) => Promise<void>
  onReset: () => void
  onClose: () => void
}

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'reset', label: 'Reset' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** Edit window content: Profile/Reset pill tabs top-left, ✕ top-right, auto-saving form. */
export function EditProfileWindow({ profile, onSave, onReset, onClose }: EditProfileWindowProps) {
  const [tab, setTab] = useState<TabKey>('profile')

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="relative flex rounded-full bg-[var(--float-pill-bg)] p-1">
          {/* sliding chip behind the active option */}
          <span
            aria-hidden="true"
            className="absolute bottom-1 top-1 w-24 rounded-full transition-transform duration-200 ease-out"
            style={{
              background: 'var(--float-pill-active)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
              transform: tab === 'profile' ? 'translateX(0)' : 'translateX(100%)',
            }}
          />
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative z-10 w-24 cursor-pointer rounded-full py-1.5 text-base transition-colors duration-200 ${
                tab === t.key ? 'font-bold text-[var(--ink)]' : 'font-medium text-[var(--muted)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-[var(--ink)] transition-colors hover:bg-[var(--line-strong)]"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      {tab === 'profile' ? (
        <ProfileForm initial={profile} saveLabel="" autoSave autoFocus={false} onSave={onSave} />
      ) : (
        <div className="pt-4">
          <p className="text-sm text-[var(--muted)]">
            Removes your name and profile picture from this device. You'll set up a new identity
            next time.
          </p>
          <button
            onClick={onReset}
            className="mt-4 flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[var(--radius-sm)] bg-[var(--error)] font-bold text-white"
          >
            Reset profile
          </button>
        </div>
      )}
    </div>
  )
}
