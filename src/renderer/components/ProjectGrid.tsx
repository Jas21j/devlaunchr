import { useMemo, useState } from 'react'
import type { Project, RuntimeState } from '@shared/types'
import {
  runtimeOf, useApp, needsAttention, isLive, isBusy, type HomeFilter, type SortOrder
} from '../store'
import { openContextMenu } from '../actions'
import { TYPE_LABELS, disambiguate, tildePath, platformCopy } from '../labels'
import { StatusDot } from './StatusDot'
import { Button } from './Button'
import { Icon } from './Icon'
import { Chip, Segmented } from './ui'
import { matchesQuery } from './Sidebar'

const SORT_LABELS: Record<SortOrder, string> = {
  name: 'Name',
  recent: 'Recently started',
  status: 'Status'
}

/**
 * The home screen: every project as a card with its own preview image, with
 * the machine's state summarised in the filter row. The image is a real
 * screenshot once the project has run; before that it is whatever preview
 * asset the project ships, and failing that a placeholder derived from the
 * project's own name.
 */
export function ProjectGrid(): React.JSX.Element {
  const projects = useApp((s) => s.projects)
  const runtimes = useApp((s) => s.runtimes)
  const requirements = useApp((s) => s.requirements)
  const query = useApp((s) => s.query)
  const setQuery = useApp((s) => s.setQuery)
  const filter = useApp((s) => s.homeFilter)
  const setFilter = useApp((s) => s.setHomeFilter)
  const sort = useApp((s) => s.sort)
  const setSort = useApp((s) => s.setSort)
  const resync = useApp((s) => s.resync)
  const resyncing = useApp((s) => s.resyncing)

  const labels = useMemo(() => disambiguate(projects), [projects])

  const { visible, counts } = useMemo(() => {
    const state = { runtimes, requirements }
    const bucket = (project: Project): Exclude<HomeFilter, 'all'> => {
      if (isLive(runtimeOf(state, project.id).status)) return 'running'
      if (needsAttention(state, project.id)) return 'attention'
      return 'stopped'
    }

    const counts: Record<HomeFilter, number> = { all: projects.length, running: 0, stopped: 0, attention: 0 }
    for (const project of projects) counts[bucket(project)]++

    const rank = (project: Project): number => {
      const b = bucket(project)
      return b === 'running' ? 0 : b === 'attention' ? 1 : 2
    }

    const visible = projects
      .filter((project) => matchesQuery(project, query))
      .filter((project) => filter === 'all' || bucket(project) === filter)
      .sort((a, b) => {
        if (sort === 'status') {
          const diff = rank(a) - rank(b)
          if (diff !== 0) return diff
        } else if (sort === 'recent') {
          const diff = (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '')
          if (diff !== 0) return diff
        } else if (a.favorite !== b.favorite) {
          return a.favorite ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

    return { visible, counts }
  }, [projects, runtimes, requirements, query, filter, sort])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-hairline bg-raised">
      <header className="flex shrink-0 flex-col gap-[14px] border-b border-hairline px-[20px] pb-[14px] pt-[18px]">
        <div className="flex items-center justify-between gap-[12px]">
          <div className="flex min-w-0 items-baseline gap-[10px]">
            <h1 className="text-section font-semibold tracking-[-0.02em]">All projects</h1>
            <span className="text-caption text-ink-muted">
              {visible.length === projects.length ? projects.length : `${visible.length} of ${projects.length}`}
            </span>
          </div>
          <div className="flex items-center gap-[8px]">
            <label className="relative flex items-center">
              <span className="pointer-events-none absolute left-[9px] text-ink-placeholder">
                <Icon name="search" size={13} />
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by name or path"
                spellCheck={false}
                aria-label="Filter projects"
                className="field h-[30px] w-[200px] pl-[28px]"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setQuery('')
                }}
              />
            </label>
            <label className="flex items-center gap-[6px] text-caption text-ink-muted">
              <span className="sr-only">Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOrder)}
                className="field h-[30px] w-auto appearance-none pr-[10px] text-caption"
                aria-label="Sort projects"
              >
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
                  <option key={key} value={key}>
                    Sort: {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              iconOnly
              icon="refresh"
              variant="secondary"
              disabled={resyncing}
              onClick={() => void resync()}
              aria-label="Refresh status and previews"
              title="Re-check what is running and re-take every preview image"
              className={resyncing ? 'animate-pulse' : ''}
            />
          </div>
        </div>

        <Segmented<HomeFilter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: <FilterLabel text="All" count={counts.all} /> },
            { value: 'running', label: <FilterLabel text="Running" count={counts.running} dot="running" /> },
            { value: 'stopped', label: <FilterLabel text="Stopped" count={counts.stopped} dot="stopped" /> },
            {
              value: 'attention',
              label: <FilterLabel text="Needs attention" count={counts.attention} dot="crashed" />
            }
          ]}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[14px] p-[20px]">
            {visible.map((project) => (
              <Card key={project.id} project={project} label={labels.get(project.id) ?? project.name} />
            ))}
          </div>
        ) : (
          <EmptyFilter filter={filter} query={query} onReset={() => {
            setQuery('')
            setFilter('all')
          }} />
        )}
      </div>
    </div>
  )
}

function FilterLabel({
  text,
  count,
  dot
}: {
  text: string
  count: number
  dot?: RuntimeState['status']
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-[6px]">
      {dot && <StatusDot status={dot} size={6} />}
      {text}
      <span className="tabular-nums text-ink-placeholder">{count}</span>
    </span>
  )
}

function EmptyFilter({
  filter,
  query,
  onReset
}: {
  filter: HomeFilter
  query: string
  onReset: () => void
}): React.JSX.Element {
  const text =
    query.trim().length > 0
      ? `No project matches “${query.trim()}”.`
      : filter === 'running'
        ? 'Nothing is running. Start a project and it shows up here.'
        : filter === 'attention'
          ? 'Every project is ready to run.'
          : 'No projects here.'
  return (
    <div className="flex flex-col items-center gap-[10px] px-[20px] py-[56px] text-center">
      <p className="text-body text-ink-secondary">{text}</p>
      <Button size="sm" onClick={onReset}>
        Show all projects
      </Button>
    </div>
  )
}

function Card({ project, label }: { project: Project; label: string }): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const thumb = useApp((s) => s.thumbs[project.id])
  const missingTools = useApp((s) => s.requirements[project.id]?.length ?? 0)
  const home = useApp((s) => s.info?.home ?? '')
  const select = useApp((s) => s.select)
  const start = useApp((s) => s.start)
  const stop = useApp((s) => s.stop)
  const install = useApp((s) => s.install)

  const [broken, setBroken] = useState(false)
  const busy = isBusy(runtime.status)
  const live = isLive(runtime.status)
  const running = runtime.status === 'running'

  const problem =
    runtime.status === 'crashed'
      ? 'Crashed'
      : runtime.status === 'installing'
        ? 'Installing'
        : runtime.needsInstall
          ? 'Needs install'
          : missingTools > 0
            ? 'Missing tools'
            : null

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-card border bg-recessed transition-[border-color,box-shadow] duration-[180ms] hover:shadow-[var(--shadow-card-hover)]"
      style={{ borderColor: running ? 'var(--accent-border)' : 'var(--border-hairline)' }}
      onContextMenu={(event) => {
        event.preventDefault()
        void openContextMenu(project)
      }}
    >
      <button
        type="button"
        onClick={() => select(project.id)}
        className="relative block aspect-[16/10] w-full overflow-hidden bg-inset"
        aria-label={`Open ${label}`}
      >
        {thumb && !broken ? (
          <img
            src={thumb.url}
            alt=""
            onError={() => setBroken(true)}
            className="size-full object-cover object-top transition-transform duration-[300ms] group-hover:scale-[1.015]"
            // A disk-sourced preview is artwork, not a screenshot of the site,
            // so it is shown whole rather than cropped to the top.
            style={thumb.fromDisk ? { objectFit: 'contain' } : undefined}
          />
        ) : (
          <Placeholder label={label} />
        )}

        <span className="absolute left-[8px] top-[8px] flex items-center gap-[4px]">
          {project.favorite && (
            <span className="flex size-[20px] items-center justify-center rounded-[7px] bg-raised/90 text-ink-secondary" title="Favorite">
              <Icon name="star" size={11} />
            </span>
          )}
          {problem && <Chip tone={runtime.status === 'crashed' ? 'danger' : 'warn'}>{problem}</Chip>}
        </span>

        {runtime.port !== null && live && (
          <span
            className="absolute bottom-[8px] right-[8px] flex h-[20px] items-center gap-[4px] rounded-pill px-[8px] font-mono text-micro font-medium"
            style={
              running
                ? { background: 'var(--accent-solid)', color: 'var(--accent-on)' }
                : { background: 'var(--surface-raised)', color: 'var(--text-secondary)' }
            }
          >
            {runtime.external && <span title="Started outside devLaunchr">↗</span>}:{runtime.port}
          </span>
        )}
      </button>

      <div className="flex items-center gap-[10px] border-t border-hairline bg-raised px-[12px] py-[10px]">
        <StatusDot status={runtime.status} />
        <button
          type="button"
          onClick={() => select(project.id)}
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <span className="truncate text-ui font-medium text-ink" title={label}>
            {label}
          </span>
          <span className="truncate text-micro text-ink-muted" title={project.path}>
            {TYPE_LABELS[project.type]} · <span className="font-mono">{tildePath(project.path, home)}</span>
          </span>
        </button>

        {runtime.needsInstall && !live ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void install(project.id)}
            title={`Run ${project.installCommand ?? 'the install command'}`}
          >
            Install
          </Button>
        ) : live ? (
          <Button
            size="sm"
            iconOnly
            icon="stop"
            disabled={busy}
            onClick={() => void stop(project.id)}
            aria-label={runtime.external ? `Detach ${label}` : `Stop ${label}`}
            title={runtime.external ? 'Stop showing it here; it keeps running' : 'Stop'}
          />
        ) : (
          <Button
            size="sm"
            iconOnly
            icon="play"
            variant="primary"
            disabled={busy}
            onClick={() => void start(project.id)}
            aria-label={`Start ${label}`}
            title="Start"
          />
        )}
      </div>
    </article>
  )
}

/**
 * Deterministic placeholder for a project that has never run and ships no
 * preview asset.
 *
 * A sparse pixel field seeded from the project's name echoes the pixel-block
 * mark, with the project's initials on a small tile. Initials come from the
 * whole disambiguated label, parent folder included — deriving them from the
 * trailing segment alone made every project called `site` an identical "S".
 * It stays achromatic, so a wall of placeholders never competes with the real
 * screenshots beside it.
 */
function Placeholder({ label }: { label: string }): React.JSX.Element {
  const segments = label.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const initials =
    segments.length === 1
      ? (segments[0] ?? '').slice(0, 2).toUpperCase()
      : segments
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? '')
          .join('')

  // A small xorshift keeps the field stable for a given name across renders
  // and restarts, so a project's tile never changes on its own.
  let seed = 2166136261
  for (let i = 0; i < label.length; i++) {
    seed ^= label.charCodeAt(i)
    seed = Math.imul(seed, 16777619) >>> 0
  }
  const next = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    return seed / 0xffffffff
  }

  const COLUMNS = 16
  const ROWS = 10
  const blocks: Array<{ x: number; y: number; opacity: number }> = []
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLUMNS; x++) {
      const roll = next()
      if (roll > 0.2) continue
      blocks.push({ x, y, opacity: roll < 0.05 ? 0.11 : roll < 0.12 ? 0.07 : 0.04 })
    }
  }

  return (
    <span className="relative flex size-full items-center justify-center bg-inset">
      <svg
        aria-hidden
        viewBox={`0 0 ${COLUMNS} ${ROWS}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full text-ink"
      >
        {blocks.map((block) => (
          <rect
            key={`${block.x}-${block.y}`}
            x={block.x}
            y={block.y}
            width="1"
            height="1"
            fill="currentColor"
            opacity={block.opacity}
          />
        ))}
      </svg>
      <span
        className="relative flex size-[46px] items-center justify-center rounded-[13px] border border-hairline bg-raised text-[17px] font-semibold tracking-[-0.02em] text-ink-muted"
        style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
      >
        {initials || '·'}
      </span>
    </span>
  )
}

export function EmptyState(): React.JSX.Element {
  const platform = useApp((s) => s.info?.platform)
  const startScan = useApp((s) => s.startScan)
  const beginAdd = useApp((s) => s.beginAdd)
  const copy = platformCopy(platform)

  return (
    <div className="flex flex-1 items-center justify-center rounded-panel border border-hairline bg-raised">
      <div className="flex max-w-[440px] flex-col items-center gap-[14px] px-[24px] text-center">
        <span className="flex size-[64px] items-center justify-center rounded-[18px] bg-[var(--color-obsidian)]">
          <Icon name="rocket" size={30} className="text-[var(--color-launch)]" strokeWidth={1.3} />
        </span>
        <h1 className="text-display font-semibold leading-[1.15] tracking-[-0.025em]">Launch everything you are building</h1>
        <p className="text-body leading-[1.5] text-ink-secondary">
          Scan {copy.computer} to find every local site and app, or add one folder by hand. devLaunchr works out how
          to run each one, and nothing is added until you confirm.
        </p>
        <div className="mt-[6px] flex items-center gap-[8px]">
          <Button variant="primary" icon="scan" onClick={() => void startScan()}>
            Scan {copy.computer}
          </Button>
          <Button icon="plus" onClick={() => void beginAdd()}>
            Add a folder
          </Button>
        </div>
      </div>
    </div>
  )
}
