import { useEffect, useRef } from 'react'
import { useTheme } from '@freeappstore/sdk/hooks'

import { withThemeFade } from '../lib/themeFade'

const ORDER = ['system', 'light', 'dark'] as const

/**
 * Sun/moon theme toggle (cycles system → light → dark, like the SDK's). While
 * following the system theme, a small "A" (auto) is part of the icon itself,
 * tucked into its bottom-right corner.
 */
export function ThemeButton() {
  const { theme, preference, setPreference } = useTheme()
  const auto = preference === 'system'

  // Don't trust the store's cached resolved theme for the glyph: if the OS theme
  // changed while this button was unmounted (e.g. on the welcome screen), the
  // cache is stale until the next setPreference. Resolve live instead.
  const resolved: 'light' | 'dark' = auto
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : (preference as 'light' | 'dark')
  void theme

  // The SDK theme store only re-resolves on setPreference — it doesn't watch the
  // OS. Re-trigger it when the system scheme changes so the icon (and the page's
  // data-theme) follow along live while in auto.
  const prefRef = useRef(preference)
  prefRef.current = preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (prefRef.current === 'system') withThemeFade(() => setPreference('system'))
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [setPreference])

  const cycle = () => {
    const idx = ORDER.indexOf(preference as (typeof ORDER)[number])
    withThemeFade(() => setPreference(ORDER[(idx + 1) % ORDER.length]))
  }

  return (
    <button
      onClick={cycle}
      aria-label={`Theme: ${preference}`}
      title={`Theme: ${preference}`}
      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface,#fff)] text-[var(--ink)] transition-colors hover:bg-[var(--glass-hover)]"
      // own view-transition group: the page crossfades, this button snaps
      style={{ viewTransitionName: 'theme-toggle' }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* auto mode: glyph stays nearly full size; AUTO overlaps its bottom third */}
        {/* glyph mirrors the active theme: sun when light, moon when dark.
            auto mode: glyph tucks top-left, big A bottom-right */}
        {/* the sun's rays reach the viewBox edges, so it needs a smaller auto
            scale than the moon to stay in bounds */}
        <g transform={auto ? (resolved === 'dark' ? 'translate(-2 -2) scale(0.92)' : 'scale(0.76)') : undefined}>
          {resolved === 'dark' ? (
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          ) : (
            <>
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </>
          )}
        </g>
        {auto && (
          <text
            x="18"
            y="24"
            textAnchor="middle"
            fontSize="13"
            fontWeight="800"
            fill="currentColor"
            // knock-out halo so AUTO stays readable where it overlaps the glyph
            stroke="var(--surface, #fff)"
            strokeWidth="4.5"
            paintOrder="stroke"
            fontFamily="inherit"
          >
            A
          </text>
        )}
      </svg>
    </button>
  )
}
