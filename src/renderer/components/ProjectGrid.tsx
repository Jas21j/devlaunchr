import { useMemo, useState } from 'react'
import type { Project } from '@shared/types'
import { runtimeOf, useApp } from '../store'
import { openContextMenu } from '../actions'
import { TYPE_LABELS, disambiguate, tildePath } from '../labels'
import { StatusDot } from './StatusDot'
import { Button } from './Button'

/**
 * Every detected project as a card with its own preview image. The image is a
 * real screenshot once the project has run; before that it is whatever preview
 * asset the project ships, and failing that a generated placeholder derived
 * from the project's own name.
 */
export function ProjectGrid({ home }: { home: string }): React.JSX.Element {
  const projects = useApp((s) => s.projects)
  const query = useApp((s) => s.query)

  const labels = useMemo(() => disambiguate(projects), [projects])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = needle
      ? projects.filter(
          (p) => p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle)
        )
      : projects
    // Favourites first, then running, then alphabetical.
    return [...matches].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [projects, query])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-panel border border-hairline bg-raised">
      <header className="flex items-baseline gap-[8px] px-[20px] pb-[4px] pt-[18px]">
        <h1 className="text-subheading font-semibold tracking-[-0.01em]">All projects</h1>
        <span className="text-caption text-ink-muted">
          {visible.length} of {projects.length}
        </span>
      </header>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-[14px] p-[20px]">
        {visible.map((project) => (
          <Card
            key={project.id}
            project={project}
            label={labels.get(project.id) ?? project.name}
            home={home}
          />
        ))}
      </div>

      {visible.length === 0 && (
        <p className="px-[20px] pb-[24px] text-ui text-ink-muted">Nothing matches that search.</p>
      )}
    </div>
  )
}

function Card({
  project,
  label,
  home
}: {
  project: Project
  label: string
  home: string
}): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const thumb = useApp((s) => s.thumbs[project.id])
  const select = useApp((s) => s.select)
  const start = useApp((s) => s.start)
  const stop = useApp((s) => s.stop)
  const install = useApp((s) => s.install)

  const [broken, setBroken] = useState(false)
  const busy =
    runtime.status === 'starting' ||
    runtime.status === 'stopping' ||
    runtime.status === 'installing'
  const live = runtime.status === 'running' || runtime.status === 'starting'

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-card border border-hairline transition-colors"
      style={{ background: 'var(--surface-recessed)' }}
      onContextMenu={(event) => {
        event.preventDefault()
        void openContextMenu(project)
      }}
    >
      <button
        type="button"
        onClick={() => select(project.id)}
        className="relative block aspect-[16/10] w-full overflow-hidden"
        style={{ background: 'var(--surface-inset)' }}
        title={project.path}
      >
        {thumb && !broken ? (
          <img
            src={thumb.url}
            alt=""
            onError={() => setBroken(true)}
            className="size-full object-cover object-top"
            // A disk-sourced preview is artwork, not a screenshot of the site,
            // so it is shown whole rather than cropped to the top.
            style={thumb.fromDisk ? { objectFit: 'contain' } : undefined}
          />
        ) : (
          <Placeholder label={label} />
        )}

        {runtime.port !== null && (
          <span className="absolute bottom-[8px] right-[8px] flex items-center gap-[5px] rounded-badge bg-[var(--color-obsidian)] px-[7px] py-[2px] font-mono text-micro text-[var(--color-snow)]">
            {runtime.external && <span title="Started outside devLaunchr">↗</span>}:{runtime.port}
          </span>
        )}
      </button>

      <div className="flex items-center gap-[8px] px-[12px] py-[10px]">
        <StatusDot status={runtime.status} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui text-ink" title={label}>
            {label}
          </span>
          <span className="truncate font-mono text-micro text-ink-muted">
            {tildePath(project.path, home)}
          </span>
        </div>

        <span className="shrink-0 rounded-badge border border-hairline px-[7px] py-[1px] text-micro text-ink-secondary group-hover:hidden">
          {TYPE_LABELS[project.type]}
        </span>

        <div className="hidden shrink-0 group-hover:block">
          {runtime.needsInstall && !live ? (
            <Button
              className="h-[22px] px-[8px] text-micro"
              disabled={busy}
              onClick={() => void install(project.id)}
              title="This project's dependencies are not installed"
            >
              Install
            </Button>
          ) : live ? (
            <Button
              variant="primary"
              className="h-[22px] px-[8px] text-micro"
              disabled={busy}
              onClick={() => void stop(project.id)}
              title={runtime.external ? 'Stop showing it here; it keeps running' : undefined}
            >
              {runtime.external ? 'Detach' : 'Stop'}
            </Button>
          ) : (
            <Button
              variant="primary"
              className="h-[22px] px-[8px] text-micro"
              disabled={busy}
              onClick={() => void start(project.id)}
            >
              Start
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

/**
 * Deterministic placeholder for a project that has never run and ships no
 * preview asset.
 *
 * The tile is a pixel field seeded from the project's name, echoing the
 * pixel-block logo. Initials come from the whole disambiguated label, parent
 * folder included — deriving them from the trailing segment alone made every
 * project called `site` an identical letter S. Everything stays achromatic, so
 * a wall of placeholders never competes with the real screenshots beside it.
 */
function Placeholder({ label }: { label: string }): React.JSX.Element {
  const segments = label.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const initials =
    segments.length === 1
      ? (segments[0] ?? '').slice(0, 2).toUpperCase()
      : segments
          .slice(0, 3)
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
      if (roll > 0.34) continue
      blocks.push({ x, y, opacity: roll < 0.08 ? 0.16 : roll < 0.2 ? 0.1 : 0.06 })
    }
  }

  return (
    <span className="relative flex size-full items-center justify-center bg-inset">
      <svg
        aria-hidden
        viewBox={`0 0 ${COLUMNS} ${ROWS}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
      >
        {blocks.map((block) => (
          <rect
            key={`${block.x}-${block.y}`}
            x={block.x}
            y={block.y}
            width="1"
            height="1"
            fill="currentColor"
            className="text-ink"
            opacity={block.opacity}
          />
        ))}
      </svg>
      <span
        className="relative font-semibold tracking-[-0.02em] text-ink-placeholder"
        style={{ fontSize: initials.length > 2 ? 24 : 30 }}
      >
        {initials || '·'}
      </span>
    </span>
  )
}
