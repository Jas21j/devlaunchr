import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LogLine } from '@shared/types'
import { useApp } from '../store'
import { Icon } from './Icon'

const STREAM_COLOR: Record<LogLine['stream'], string> = {
  stdout: 'var(--text-secondary)',
  stderr: 'var(--tone-danger-text)',
  system: 'var(--text-muted)'
}

/** Stable identity so effects keyed on `lines` do not fire on every render. */
const NO_LINES: LogLine[] = []

const HEADER_HEIGHT = 38

const clock = (ts: number): string => {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function LogPane({ projectId }: { projectId: string }): React.JSX.Element {
  const lines = useApp((s) => s.logs[projectId]) ?? NO_LINES
  const filter = useApp((s) => s.logFilter)
  const setFilter = useApp((s) => s.setLogFilter)
  const clearLogs = useApp((s) => s.clearLogs)
  const loadLogs = useApp((s) => s.loadLogs)
  const open = useApp((s) => s.logPaneOpen)
  const toggle = useApp((s) => s.toggleLogPane)
  const height = useApp((s) => s.logHeight)
  const setHeight = useApp((s) => s.setLogHeight)
  const notify = useApp((s) => s.notify)

  const scroller = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void loadLogs(projectId)
  }, [projectId, loadLogs])

  // Auto-scroll only while the view is already at the bottom. Yanking the
  // viewport down while someone is reading an error further up is the single
  // most irritating thing a log pane can do.
  useLayoutEffect(() => {
    if (!pinned || !open) return
    const node = scroller.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lines, pinned, open, height])

  const needle = filter.trim().toLowerCase()
  const visible = needle ? lines.filter((line) => line.text.toLowerCase().includes(needle)) : lines
  const errors = lines.reduce((count, line) => count + (line.stream === 'stderr' ? 1 : 0), 0)

  /** Dragging the top edge resizes the pane; the height is remembered. */
  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!open) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    setDragging(true)
    const onMove = (move: PointerEvent): void => setHeight(startHeight + (startY - move.clientY))
    const onUp = (): void => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <section
      aria-label="Logs"
      className="relative flex shrink-0 flex-col overflow-hidden rounded-panel border border-hairline bg-recessed"
      style={{ height: open ? height : HEADER_HEIGHT }}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize logs"
          onPointerDown={beginResize}
          onDoubleClick={() => setHeight(220)}
          className="group absolute inset-x-0 top-0 z-10 flex h-[7px] cursor-row-resize justify-center"
        >
          <span
            className={`mt-[2px] h-[3px] w-[36px] rounded-pill transition-colors ${
              dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-strong'
            }`}
          />
        </div>
      )}

      <header
        className="flex shrink-0 items-center gap-[8px] border-b border-hairline px-[12px]"
        style={{ height: HEADER_HEIGHT - 1, borderBottomColor: open ? undefined : 'transparent' }}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-[7px] rounded-[7px] py-[2px] text-ink-muted hover:text-ink"
        >
          <span
            className="flex transition-transform duration-[120ms]"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          >
            <Icon name="chevronRight" size={12} strokeWidth={1.8} />
          </span>
          <span className="text-micro font-medium uppercase tracking-[0.06em]">Logs</span>
        </button>

        <span className="font-mono text-micro text-ink-placeholder">
          {needle ? `${visible.length}/${lines.length}` : lines.length}
        </span>
        {errors > 0 && (
          <span className="rounded-pill bg-[var(--tone-danger-soft)] px-[6px] font-mono text-micro text-danger" title="Lines written to stderr">
            {errors} stderr
          </span>
        )}

        <div className="flex-1" />

        {open && (
          <>
            <label className="relative flex items-center">
              <span className="pointer-events-none absolute left-[7px] text-ink-placeholder">
                <Icon name="search" size={11} />
              </span>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter"
                spellCheck={false}
                aria-label="Filter log lines"
                className="field h-[24px] w-[150px] pl-[22px] font-mono text-micro"
              />
            </label>
            {!pinned && (
              <PaneButton
                onClick={() => {
                  setPinned(true)
                  const node = scroller.current
                  if (node) node.scrollTop = node.scrollHeight
                }}
              >
                Follow
              </PaneButton>
            )}
            <PaneButton
              disabled={lines.length === 0}
              onClick={() =>
                void navigator.clipboard
                  .writeText(visible.map((line) => `${clock(line.ts)}  ${line.text}`).join('\n'))
                  .then(() => notify(`Copied ${visible.length} log line${visible.length === 1 ? '' : 's'}.`, 'success'))
              }
            >
              Copy
            </PaneButton>
            <PaneButton disabled={lines.length === 0} onClick={() => void clearLogs(projectId)}>
              Clear
            </PaneButton>
          </>
        )}
      </header>

      {open && (
        <div
          ref={scroller}
          onScroll={(event) => {
            const node = event.currentTarget
            const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
            setPinned(atBottom)
          }}
          className="selectable min-h-0 flex-1 overflow-y-auto px-[12px] py-[8px] font-mono text-micro leading-[1.6]"
        >
          {visible.length === 0 ? (
            <p className="text-ink-placeholder">
              {lines.length === 0 ? 'No output yet. Start the project and its output appears here.' : 'Nothing matches that filter.'}
            </p>
          ) : (
            visible.map((line, index) => (
              <div key={`${line.ts}-${index}`} className="flex gap-[12px] whitespace-pre-wrap">
                <span className="shrink-0 text-ink-placeholder">{clock(line.ts)}</span>
                <span className="min-w-0 break-all" style={{ color: STREAM_COLOR[line.stream] }}>
                  {line.text}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}

function PaneButton({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[24px] rounded-[8px] px-[8px] text-micro font-medium text-ink-muted hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}
