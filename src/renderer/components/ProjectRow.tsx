import type { Project, ProjectStatus } from '@shared/types'
import { StatusDot } from './StatusDot'
import { TYPE_LABELS } from '../labels'

interface ProjectRowProps {
  project: Project
  label: string
  status: ProjectStatus
  port: number | null
  selected: boolean
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
}

export function ProjectRow({
  project,
  label,
  status,
  port,
  selected,
  onSelect,
  onContextMenu
}: ProjectRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className="group flex h-[30px] w-full items-center gap-[8px] rounded-card px-[8px] text-left transition-colors duration-[120ms]"
      style={{
        background: selected ? 'var(--surface-active)' : undefined
      }}
      onMouseEnter={(event) => {
        if (!selected) event.currentTarget.style.background = 'var(--surface-hover)'
      }}
      onMouseLeave={(event) => {
        if (!selected) event.currentTarget.style.background = ''
      }}
    >
      <StatusDot status={status} />
      <span className="min-w-0 flex-1 truncate text-ui text-ink" title={label}>
        {label}
      </span>
      {port !== null ? (
        <span className="font-mono text-micro text-ink-muted">:{port}</span>
      ) : (
        <span className="text-micro text-ink-muted opacity-0 transition-opacity group-hover:opacity-100">
          {TYPE_LABELS[project.type]}
        </span>
      )}
      {project.favorite && <span className="text-micro text-ink-placeholder">★</span>}
    </button>
  )
}
