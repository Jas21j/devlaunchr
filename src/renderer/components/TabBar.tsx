import type { Project } from '@shared/types'
import { runtimeOf, useApp } from '../store'
import { StatusDot } from './StatusDot'
import { disambiguate } from '../labels'
import { useMemo } from 'react'

/**
 * One tab per project with an open preview. Tabs appear automatically when a
 * project starts, and closing one never stops its server.
 */
export function TabBar(): React.JSX.Element | null {
  const tabs = useApp((s) => s.tabs)
  const projects = useApp((s) => s.projects)
  const selectedId = useApp((s) => s.selectedId)
  const select = useApp((s) => s.select)
  const closeTab = useApp((s) => s.closeTab)

  const labels = useMemo(() => disambiguate(projects), [projects])

  const open = tabs
    .map((id) => projects.find((project) => project.id === id))
    .filter((project): project is Project => project !== undefined)

  if (open.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-[4px] overflow-x-auto pb-[2px]">
      {open.map((project) => (
        <Tab
          key={project.id}
          project={project}
          label={labels.get(project.id) ?? project.name}
          active={selectedId === project.id}
          onSelect={() => select(project.id)}
          onClose={() => closeTab(project.id)}
        />
      ))}
    </div>
  )
}

function Tab({
  project,
  label,
  active,
  onSelect,
  onClose
}: {
  project: Project
  label: string
  active: boolean
  onSelect: () => void
  onClose: () => void
}): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))

  return (
    <div
      className="group flex h-[28px] shrink-0 items-center gap-[7px] rounded-card border px-[10px] transition-colors"
      style={{
        background: active ? 'var(--surface-raised)' : 'transparent',
        borderColor: active ? 'var(--border-hairline)' : 'transparent'
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 items-center gap-[7px]"
        title={project.path}
      >
        <StatusDot status={runtime.status} />
        <span
          className="max-w-[148px] truncate text-ui"
          style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          {label}
        </span>
        {runtime.port !== null && (
          <span className="font-mono text-micro text-ink-muted">:{runtime.port}</span>
        )}
      </button>

      <button
        type="button"
        aria-label={`Close ${label} preview`}
        title="Close preview (the server keeps running)"
        onClick={onClose}
        className="flex size-[15px] shrink-0 items-center justify-center rounded-[7px] text-ink-placeholder opacity-0 transition-opacity hover:bg-[var(--surface-hover)] hover:text-ink group-hover:opacity-100"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 1 L7 7 M7 1 L1 7" />
        </svg>
      </button>
    </div>
  )
}
