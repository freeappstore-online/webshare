import { useEffect, useRef, useState } from 'react'

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
export function FinderFileName({ name }: { name: string }) {
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
export function ListFileName({ name }: { name: string }) {
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
