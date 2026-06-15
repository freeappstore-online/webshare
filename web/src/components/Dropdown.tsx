import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, ChevronDownIcon } from './icons'

interface DropdownProps<T extends string | number> {
  value: T
  options: Array<{ value: T; label: ReactNode }>
  onChange: (value: T) => void
  ariaLabel: string
  /** custom trigger content (e.g. an icon); defaults to the selected value */
  trigger?: ReactNode
}

/** App-styled dropdown: panel-colored trigger, floating listbox below it. */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  trigger,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number; maxHeight?: number }>()
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // full height below the trigger; pushed up when it would overflow the
    // bottom of the screen, and only scrolling once it also hits the top
    const fit = () => {
      const rect = root.current?.getBoundingClientRect()
      const el = list.current
      if (!rect || !el) return
      const margin = 12
      const height = el.scrollHeight + 2
      let top = rect.bottom + 4
      let maxHeight: number | undefined
      if (top + height > window.innerHeight - margin) top = window.innerHeight - margin - height
      if (top < margin) {
        top = margin
        maxHeight = window.innerHeight - margin * 2
      }
      // center the list under the trigger, clamped to the viewport
      const centerX = rect.left + rect.width / 2
      const width = Math.max(el.offsetWidth, rect.width)
      const left = Math.min(
        Math.max(centerX - width / 2, margin),
        window.innerWidth - margin - width,
      )
      setPos({ top, left, minWidth: rect.width, maxHeight })
    }
    fit()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex cursor-pointer items-center gap-1 rounded-[0.4rem] border border-[var(--line)] bg-[var(--panel-strong)] py-2 pl-3 pr-2 text-sm font-semibold text-[var(--ink)] transition-none hover:bg-[var(--line-strong)]"
      >
        {trigger ?? options.find((o) => o.value === value)?.label ?? value}
        <span className="text-[var(--muted)]">
          <ChevronDownIcon size={16} />
        </span>
      </button>
      {open && createPortal(
        <ul
          ref={list}
          role="listbox"
          aria-label={ariaLabel}
          className="fixed z-[200] overflow-y-auto rounded-[var(--radius-sm)] p-1"
          style={{
            // same elevated surface as the floating windows, with quieter edges
            background: 'var(--float-bg)',
            border: '1px solid var(--line-strong)',
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.16), 0 3px 8px rgba(0, 0, 0, 0.08)',
            ...(pos ?? { visibility: 'hidden' }),
          }}
        >
          {options.map((option) => (
            <li key={option.value}>
              <button
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className="flex w-full cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-[0.35rem] py-1.5 pl-2 pr-4 text-left text-sm font-semibold text-[var(--ink)] transition-none hover:bg-[var(--accent)] hover:text-white"
              >
                <span className="w-4 shrink-0">{option.value === value && <CheckIcon size={16} />}</span>
                {option.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  )
}
