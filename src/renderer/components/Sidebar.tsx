import { useMemo } from 'react'
import type { Project } from '@shared/types'
import { useApp, runtimeOf } from '../store'
import { openContextMenu } from '../actions'
import { ProjectRow } from './ProjectRow'
import { Button } from './Button'
import { disambiguate } from '../labels'

export function Sidebar(): React.JSX.Element {
  const projects = useApp((s) => s.projects)
  const query = useApp((s) => s.query)
  const selectedId = useApp((s) => s.selectedId)
  const setQuery = useApp((s) => s.setQuery)
  const select = useApp((s) => s.select)
  const beginAdd = useApp((s) => s.beginAdd)

  const labels = useMemo(() => disambiguate(projects), [projects])

  const { favorites, rest } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = needle
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle)
        )
      : projects

    const byName = (a: Project, b: Project): number => a.name.localeCompare(b.name)
    return {
      favorites: matches.filter((p) => p.favorite).sort(byName),
      rest: matches.filter((p) => !p.favorite).sort(byName)
    }
  }, [projects, query])

  const empty = projects.length === 0
  const noMatches = !empty && favorites.length === 0 && rest.length === 0

  return (
    <aside className="flex w-[var(--sidebar-width)] shrink-0 flex-col gap-[12px] p-[12px]">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search projects"
        spellCheck={false}
        className="h-[28px] w-full shrink-0 rounded-control border border-hairline bg-raised px-[10px] text-ui text-ink placeholder:text-ink-placeholder focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-1"
      />

      <div className="-mx-[4px] flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[4px]">
        {favorites.length > 0 && (
          <Section label="★ Favorites">
            {favorites.map((project) => (
              <Row
                key={project.id}
                project={project}
                label={labels.get(project.id) ?? project.name}
                selected={selectedId === project.id}
                onSelect={select}
              />
            ))}
          </Section>
        )}

        {rest.length > 0 && (
          <Section label="All projects">
            {rest.map((project) => (
              <Row
                key={project.id}
                project={project}
                label={labels.get(project.id) ?? project.name}
                selected={selectedId === project.id}
                onSelect={select}
              />
            ))}
          </Section>
        )}

        {noMatches && (
          <p className="px-[8px] pt-[4px] text-caption text-ink-muted">
            Nothing matches “{query.trim()}”.
          </p>
        )}
      </div>

      <Button variant="subtle" className="w-full shrink-0 justify-start px-[8px]" onClick={() => void beginAdd()}>
        + Add project
      </Button>
    </aside>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="px-[8px] pb-[4px] text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </span>
      {children}
    </div>
  )
}

function Row({
  project,
  label,
  selected,
  onSelect
}: {
  project: Project
  label: string
  selected: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))

  return (
    <ProjectRow
      project={project}
      label={label}
      status={runtime.status}
      port={runtime.port}
      selected={selected}
      onSelect={() => onSelect(project.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        onSelect(project.id)
        void openContextMenu(project)
      }}
    />
  )
}
