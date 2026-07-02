import { useRef } from 'react'
import { SHARE_CODE_LENGTH } from '../lib/shareCode'

interface CodeInputProps {
  value: string
  onChange: (value: string) => void
  /** Fires once when the last box is filled. */
  onComplete: (code: string) => void
  disabled?: boolean
}

/** Six one-digit boxes with auto-advance, backspace-retreat and full-code paste. */
export function CodeInput({ value, onChange, onComplete, disabled }: CodeInputProps) {
  const boxes = useRef<Array<HTMLInputElement | null>>([])

  const setDigits = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, SHARE_CODE_LENGTH)
    onChange(digits)
    boxes.current[Math.min(digits.length, SHARE_CODE_LENGTH - 1)]?.focus()
    if (digits.length === SHARE_CODE_LENGTH) onComplete(digits)
  }

  return (
    <div className="flex justify-center gap-2" onPaste={(e) => {
      e.preventDefault()
      setDigits(e.clipboardData.getData('text'))
    }}>
      {Array.from({ length: SHARE_CODE_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => { boxes.current[i] = el }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={SHARE_CODE_LENGTH /* let a full code typed into one box spill over */}
          value={value[i] ?? ''}
          disabled={disabled}
          aria-label={`Share code digit ${i + 1}`}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '')
            if (!typed) return
            setDigits(value.slice(0, i) + typed + value.slice(i + typed.length))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault()
              const cut = value[i] ? i : Math.max(i - 1, 0)
              onChange(value.slice(0, cut))
              boxes.current[cut]?.focus()
            } else if (e.key === 'ArrowLeft') {
              boxes.current[i - 1]?.focus()
            } else if (e.key === 'ArrowRight') {
              boxes.current[i + 1]?.focus()
            }
          }}
          className="h-13 w-10 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--float-input-bg)] text-center text-2xl font-bold text-[var(--ink)] outline-none transition-shadow focus:border-[var(--sky)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--sky)_30%,transparent)] disabled:opacity-40"
        />
      ))}
    </div>
  )
}
