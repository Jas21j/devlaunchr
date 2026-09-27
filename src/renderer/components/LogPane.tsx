import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LogLine } from '@shared/types'
import { useApp } from '../store'

const STREAM_COLOR: Record<LogLine['stream'], string> = {
  stdout: 'var(--text-secondary)',
  stderr: 'var(--status-crashed)',
  system: 'var(--text-muted)'
}

/** Stable identity so effects keyed on `lines` do not fire on every render. */
const NO_LINES: LogLine[] = []

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

  const scroller = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

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
  }, [lines, pinned, open])

  const needle = filter.trim().toLowerCase()
  const visible = needle
    ? lines.filter((line) => line.text.toLowerCase().includes(needle))
    : lines

  return (
    <section
      className="flex shrink-0 flex-col overflow-hidden rounded-panel border border-hairline bg-recessed"
      style={{ height: open ? 232 : 37 }}
    >
      <header className="flex h-[36px] shrink-0 items-center gap-[8px] border-b border-hairline px-[12px]">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-[6px] text-micro font-medium uppercase tracking-[0.06em] text-ink-muted hover:text-ink"
        >
          <svg
            aria-hidden
            width="8"
            height="8"
            viewBox="0 0 8 8"
            className="transition-transform duration-[120ms]"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
          </svg>
          Logs
        </button>

        <span className="text-micro text-ink-placeholder">
          {needle ? `${visible.length}/${lines.length}` : lines.length}
        </span>

        <div className="flex-1" />

        {open && (
          <>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter"
              spellCheck={false}
              className="h-[22px] w-[132px] rounded-control border border-hairline bg-raised px-[8px] font-mono text-micro text-ink placeholder:text-ink-placeholder focus:outline-none"
            />
            {!pinned && (
              <button
                type="button"
                onClick={() => {
                  setPinned(true)
                  const node = scroller.current
                  if (node) node.scrollTop = node.scrollHeight
                }}
                className="rounded-badge border border-hairline px-[7px] py-[1px] text-micro text-ink-secondary hover:bg-[var(--surface-hover)]"
              >
                Follow
              </button>
            )}
            <button
              type="button"
              onClick={() => void clearLogs(projectId)}
              className="rounded-badge px-[7px] py-[1px] text-micro text-ink-muted hover:bg-[var(--surface-hover)] hover:text-ink"
            >
              Clear
            </button>
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
          className="selectable min-h-0 flex-1 overflow-y-auto px-[12px] py-[8px] font-mono text-micro leading-[1.55]"
        >
          {visible.length === 0 ? (
            <p className="text-ink-placeholder">
              {lines.length === 0 ? 'No output yet.' : 'Nothing matches that filter.'}
            </p>
          ) : (
            visible.map((line, index) => (
              <div key={`${line.ts}-${index}`} className="flex gap-[10px] whitespace-pre-wrap">
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
