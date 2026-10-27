import { useRef, useState, type ReactNode } from 'react'

/**
 * A list that can be reordered by dragging the ☰ handle, with a mouse or a finger
 * (pointer events, so it works the same in Telegram on phones and on desktop).
 */
export function SortableList<T>({
  items,
  getKey,
  onChange,
  render,
  handleLabel,
}: {
  items: T[]
  getKey: (item: T) => string | number
  onChange: (items: T[]) => void
  render: (item: T, index: number, handle: ReactNode) => ReactNode
  handleLabel: string
}) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  const rects = useRef<DOMRect[]>([])
  const [drag, setDrag] = useState<{ index: number; startY: number; dy: number; target: number } | null>(null)

  const start = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    rects.current = items.map((it) => refs.current[String(getKey(it))]?.getBoundingClientRect() ?? new DOMRect())
    setDrag({ index, startY: e.clientY, dy: 0, target: index })
  }

  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const dy = e.clientY - drag.startY
    const r = rects.current[drag.index]
    const center = r.top + r.height / 2 + dy
    let target = 0
    rects.current.forEach((other, i) => {
      if (i !== drag.index && other.top + other.height / 2 < center) target++
    })
    setDrag({ ...drag, dy, target })
  }

  const end = () => {
    if (!drag) return
    if (drag.target !== drag.index) {
      const next = [...items]
      const [moved] = next.splice(drag.index, 1)
      next.splice(drag.target, 0, moved)
      onChange(next)
    }
    setDrag(null)
  }

  const shiftFor = (i: number): number => {
    if (!drag || i === drag.index) return 0
    const h = rects.current[drag.index].height + 10
    if (drag.index < drag.target && i > drag.index && i <= drag.target) return -h
    if (drag.index > drag.target && i < drag.index && i >= drag.target) return h
    return 0
  }

  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const key = String(getKey(item))
        const dragging = drag?.index === i
        const handle = (
          <button
            type="button"
            aria-label={handleLabel}
            title={handleLabel}
            onPointerDown={(e) => start(e, i)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="flex h-11 w-9 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-xl text-muted active:cursor-grabbing"
          >
            ☰
          </button>
        )
        return (
          <div
            key={key}
            ref={(el) => (refs.current[key] = el)}
            style={{
              transform: `translateY(${dragging ? drag!.dy : shiftFor(i)}px)`,
              transition: dragging ? 'none' : 'transform 150ms ease',
              zIndex: dragging ? 10 : undefined,
              position: 'relative',
            }}
            className={dragging ? 'scale-[1.02] shadow-lg' : ''}
          >
            {render(item, i, handle)}
          </div>
        )
      })}
    </div>
  )
}
