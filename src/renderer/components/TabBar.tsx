import { useMemo } from 'react'
import type { Project } from '@shared/types'
import { runtimeOf, useApp } from '../store'
import { disambiguate } from '../labels'
import { StatusDot } from './StatusDot'
import { Icon } from './Icon'

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
    <div role="tablist" aria-label="Open previews" className="flex shrink-0 items-center gap-[4px] overflow-x-auto">
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
      className={`group flex h-[30px] shrink-0 items-center gap-[4px] rounded-[10px] pl-[10px] pr-[4px] transition-colors duration-[120ms] ${
        active ? 'bg-raised' : 'hover:bg-hover'
      }`}
      style={active ? { boxShadow: '0 0 0 1px var(--border-hairline)' } : undefined}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        onAuxClick={(event) => {
          // Middle-click closes, as in every browser.
          if (event.button === 1) onClose()
        }}
        className="flex min-w-0 items-center gap-[7px]"
        title={project.path}
      >
        <StatusDot status={runtime.status} />
        <span className={`max-w-[160px] truncate text-ui ${active ? 'font-medium text-ink' : 'text-ink-secondary'}`}>
          {label}
        </span>
        {runtime.port !== null && (
          <span className={`font-mono text-micro ${runtime.status === 'running' ? 'text-accent-text' : 'text-ink-muted'}`}>
            :{runtime.port}
          </span>
        )}
      </button>

      <button
        type="button"
        aria-label={`Close ${label} preview`}
        title="Close preview (the server keeps running)"
        onClick={onClose}
        className={`flex size-[20px] shrink-0 items-center justify-center rounded-[6px] text-ink-muted transition-opacity hover:bg-hover hover:text-ink focus-visible:opacity-100 ${
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <Icon name="close" size={11} strokeWidth={1.8} />
      </button>
    </div>
  )
}
