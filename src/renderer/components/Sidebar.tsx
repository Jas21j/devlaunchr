import { useMemo } from 'react'
import type { Project } from '@shared/types'
import { useApp, runtimeOf, needsAttention, isLive } from '../store'
import { openContextMenu } from '../actions'
import { disambiguate } from '../labels'
import { Button } from './Button'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'

export function matchesQuery(project: Project, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return project.name.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle)
}

export function Sidebar(): React.JSX.Element {
  const projects = useApp((s) => s.projects)
  const query = useApp((s) => s.query)
  const setQuery = useApp((s) => s.setQuery)
  const selectedId = useApp((s) => s.selectedId)
  const select = useApp((s) => s.select)
  const beginAdd = useApp((s) => s.beginAdd)
  const runningCount = useApp((s) => s.projects.filter((p) => isLive(runtimeOf(s, p.id).status)).length)

  const labels = useMemo(() => disambiguate(projects), [projects])

  const { favorites, rest } = useMemo(() => {
    const matches = projects.filter((p) => matchesQuery(p, query))
    const byName = (a: Project, b: Project): number => a.name.localeCompare(b.name)
    return {
      favorites: matches.filter((p) => p.favorite).sort(byName),
      rest: matches.filter((p) => !p.favorite).sort(byName)
    }
  }, [projects, query])

  const filtered = query.trim().length > 0
  const noMatches = projects.length > 0 && favorites.length === 0 && rest.length === 0

  return (
    <aside className="flex w-[var(--sidebar-width)] shrink-0 flex-col gap-[10px] px-[10px] pb-[10px]">
      <button
        type="button"
        onClick={() => select(null)}
        aria-current={selectedId === null ? 'page' : undefined}
        className={`group relative flex h-[34px] w-full items-center gap-[9px] rounded-card px-[10px] text-left transition-colors duration-[120ms] ${
          selectedId === null ? 'bg-raised text-ink' : 'text-ink-secondary hover:bg-hover hover:text-ink'
        }`}
        style={selectedId === null ? { boxShadow: '0 0 0 1px var(--border-hairline)' } : undefined}
      >
        <Icon name="home" size={15} />
        <span className="flex-1 text-ui font-medium">All projects</span>
        {runningCount > 0 && (
          <span
            className="flex h-[18px] items-center gap-[5px] rounded-pill bg-accent-soft px-[7px] text-micro font-medium text-accent-text"
            title={`${runningCount} running`}
          >
            <span className="size-[5px] rounded-full bg-running" />
            {runningCount}
          </span>
        )}
        <span className="text-micro text-ink-placeholder">{projects.length}</span>
      </button>

      <div className="-mx-[4px] flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[4px] pt-[2px]">
        {filtered && (
          <div className="flex items-center justify-between px-[8px] text-caption text-ink-muted">
            <span className="truncate">Matching “{query.trim()}”</span>
            <button type="button" onClick={() => setQuery('')} className="rounded-[6px] px-[4px] hover:text-ink">
              Clear
            </button>
          </div>
        )}

        {favorites.length > 0 && (
          <Section label="Favorites">
            {favorites.map((project) => (
              <Row
                key={project.id}
                project={project}
                label={labels.get(project.id) ?? project.name}
                selected={selectedId === project.id}
              />
            ))}
          </Section>
        )}

        {rest.length > 0 && (
          <Section label={favorites.length > 0 ? 'Projects' : 'All projects'}>
            {rest.map((project) => (
              <Row
                key={project.id}
                project={project}
                label={labels.get(project.id) ?? project.name}
                selected={selectedId === project.id}
              />
            ))}
          </Section>
        )}

        {noMatches && <p className="px-[10px] text-caption text-ink-muted">No project matches.</p>}
      </div>

      <Button variant="subtle" icon="plus" className="w-full !justify-start px-[10px]" onClick={() => void beginAdd()}>
        Add project
      </Button>
    </aside>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[1px]">
      <span className="eyebrow px-[10px] pb-[5px]">{label}</span>
      {children}
    </div>
  )
}

function Row({
  project,
  label,
  selected
}: {
  project: Project
  label: string
  selected: boolean
}): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const attention = useApp((s) => needsAttention(s, project.id))
  const select = useApp((s) => s.select)
  const running = runtime.status === 'running'

  return (
    <button
      type="button"
      onClick={() => select(project.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        select(project.id)
        void openContextMenu(project)
      }}
      aria-current={selected ? 'page' : undefined}
      title={project.path}
      className={`relative flex h-[30px] w-full items-center gap-[9px] rounded-[10px] px-[10px] text-left transition-colors duration-[120ms] ${
        selected ? 'bg-active' : 'hover:bg-hover'
      }`}
    >
      {selected && (
        <span className="absolute left-0 top-1/2 h-[14px] w-[3px] -translate-y-1/2 rounded-pill bg-accent" aria-hidden />
      )}
      <StatusDot status={runtime.status} />
      <span className={`min-w-0 flex-1 truncate text-ui ${selected ? 'font-medium text-ink' : 'text-ink'}`}>
        {label}
      </span>
      {attention && (
        <span className="text-warn" title="Needs attention before it can run">
          <Icon name="warning" size={13} />
        </span>
      )}
      {running && runtime.port !== null && (
        <span className="font-mono text-micro text-accent-text">:{runtime.port}</span>
      )}
    </button>
  )
}
