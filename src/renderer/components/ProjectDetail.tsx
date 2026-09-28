import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import type { Requirement } from '@shared/ipc'
import { runtimeOf, useApp, isLive, isBusy } from '../store'
import { openContextMenu } from '../actions'
import { TYPE_LABELS, tildePath, platformCopy } from '../labels'
import { editorName } from './SettingsPanel'
import { Button } from './Button'
import { Icon } from './Icon'
import { StatusDot, STATUS_LABELS } from './StatusDot'
import { Callout, Chip, Segmented } from './ui'
import { DiagnosisPanel, RequirementsPanel } from './DiagnosisPanel'
import { WebviewPane } from './WebviewPane'
import { LogPane } from './LogPane'

/** Stable identity so a project with nothing missing does not re-render. */
const NO_REQUIREMENTS: Requirement[] = []

/** How often the renderer tells idle auto-stop that a project is on screen. */
const TOUCH_INTERVAL_MS = 30_000

export type ProjectViewMode = 'preview' | 'overview'

/**
 * A project's page. When it has a preview tab, the page has two faces — the
 * live site and its overview — switched from the same control on both.
 * Keyed by project id by the caller, so the choice resets per project.
 */
export function ProjectView({ project }: { project: Project }): React.JSX.Element {
  const hasTab = useApp((s) => s.tabs.includes(project.id))
  const live = useApp((s) => isLive(runtimeOf(s, project.id).status))
  const [mode, setMode] = useState<ProjectViewMode>('preview')

  // A project on screen is in use, whatever its logs say.
  useEffect(() => {
    if (!live) return
    const touch = (): void => {
      if (document.hasFocus()) void window.devlaunchr.runtime.touch(project.id)
    }
    touch()
    const timer = setInterval(touch, TOUCH_INTERVAL_MS)
    window.addEventListener('focus', touch)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', touch)
    }
  }, [project.id, live])

  const toggle = hasTab ? <ViewToggle mode={mode} onChange={setMode} /> : null

  return (
    <>
      {hasTab && mode === 'preview' ? (
        <WebviewPane project={project} toggle={toggle} />
      ) : (
        <Overview project={project} toggle={toggle} />
      )}
      <LogPane projectId={project.id} />
    </>
  )
}

function ViewToggle({
  mode,
  onChange
}: {
  mode: ProjectViewMode
  onChange: (mode: ProjectViewMode) => void
}): React.JSX.Element {
  return (
    <Segmented<ProjectViewMode>
      label="View"
      size="sm"
      value={mode}
      onChange={onChange}
      options={[
        {
          value: 'preview',
          label: (
            <span className="flex items-center gap-[5px]">
              <Icon name="preview" size={12} /> Preview
            </span>
          )
        },
        {
          value: 'overview',
          label: (
            <span className="flex items-center gap-[5px]">
              <Icon name="details" size={12} /> Overview
            </span>
          )
        }
      ]}
    />
  )
}

function Overview({ project, toggle }: { project: Project; toggle: React.ReactNode }): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const home = useApp((s) => s.info?.home ?? '')
  const platform = useApp((s) => s.info?.platform)
  const settings = useApp((s) => s.settings)
  const missingTools = useApp((s) => s.requirements[project.id]) ?? NO_REQUIREMENTS
  const hasTab = useApp((s) => s.tabs.includes(project.id))
  const beginEdit = useApp((s) => s.beginEdit)
  const openInEditor = useApp((s) => s.openInEditor)
  const openTab = useApp((s) => s.openTab)
  const toggleFavorite = useApp((s) => s.toggleFavorite)
  const copy = platformCopy(platform)

  const envEntries = Object.entries(project.env)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-panel border border-hairline bg-raised"
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('.selectable')) return
        event.preventDefault()
        void openContextMenu(project)
      }}
    >
      <header className="flex flex-col gap-[14px] border-b border-hairline px-[24px] pb-[18px] pt-[20px]">
        <div className="flex items-start justify-between gap-[16px]">
          <div className="flex min-w-0 flex-col gap-[6px]">
            <div className="flex min-w-0 items-center gap-[10px]">
              <StatusDot status={runtime.status} size={9} />
              <h1 className="truncate text-section font-semibold tracking-[-0.02em]">{project.name}</h1>
              <Chip>{TYPE_LABELS[project.type]}</Chip>
              <button
                type="button"
                onClick={() => void toggleFavorite(project.id)}
                aria-pressed={project.favorite}
                title={project.favorite ? 'Remove from favorites' : 'Add to favorites'}
                className={`flex size-[26px] items-center justify-center rounded-[8px] hover:bg-hover ${
                  project.favorite ? 'text-ink' : 'text-ink-placeholder'
                }`}
              >
                <Icon name="star" size={14} />
              </button>
            </div>
            <p className="selectable truncate font-mono text-caption text-ink-muted" title={project.path}>
              {tildePath(project.path, home)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-[6px]">
            {toggle}
            {!hasTab && runtime.status === 'running' && (
              <Button icon="preview" onClick={() => openTab(project.id)}>
                Open preview
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-[10px]">
          <div className="flex items-center gap-[6px]">
            <Button size="sm" icon="code" onClick={() => void openInEditor(project.id)}>
              Open in {settings ? editorName(settings) : 'editor'}
            </Button>
            <Button
              size="sm"
              icon="folder"
              onClick={() => void window.devlaunchr.system.revealInFinder(project.path)}
            >
              Show in {copy.fileManager}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => beginEdit(project.id)}>
              Edit…
            </Button>
          </div>
          <RunControls project={project} />
        </div>
      </header>

      <StatusBar project={project} />

      <Problems project={project} missingTools={missingTools} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-[12px] p-[20px] pt-[4px]">
        <InfoCard title="Commands">
          <InfoRow label="Start">
            {project.startCommand ? (
              <code className="selectable font-mono text-caption">{project.startCommand}</code>
            ) : project.type === 'static' ? (
              <span className="text-ink-muted">Built-in static server</span>
            ) : (
              <span className="text-warn">Not set</span>
            )}
          </InfoRow>
          <InfoRow label="Install">
            {project.installCommand ? (
              <code className="selectable font-mono text-caption">{project.installCommand}</code>
            ) : (
              <span className="text-ink-muted">None</span>
            )}
          </InfoRow>
        </InfoCard>

        <InfoCard title="Network">
          <InfoRow label="Port">
            {runtime.port !== null ? (
              <code className="font-mono text-caption">
                {runtime.port}
                {project.preferredPort !== null && project.preferredPort !== runtime.port && (
                  <span className="text-ink-muted"> (preferred {project.preferredPort})</span>
                )}
              </code>
            ) : project.preferredPort === null ? (
              <span className="text-ink-muted">Assigned on start</span>
            ) : (
              <code className="font-mono text-caption">{project.preferredPort}</code>
            )}
          </InfoRow>
          <InfoRow label="Opens tab">{project.autoOpen ? 'As soon as it answers' : 'In the background'}</InfoRow>
        </InfoCard>

        <InfoCard title="Environment">
          {envEntries.length > 0 ? (
            <div className="flex flex-col gap-[3px]">
              {envEntries.map(([key, value]) => (
                <code key={key} className="selectable truncate font-mono text-caption">
                  <span className="text-ink-muted">{key}=</span>
                  {value}
                </code>
              ))}
            </div>
          ) : (
            <span className="text-caption text-ink-muted">Inherits your environment unchanged.</span>
          )}
        </InfoCard>

        {project.notes && (
          <InfoCard title="Notes">
            <p className="selectable whitespace-pre-wrap text-caption leading-[1.5] text-ink-secondary">
              {project.notes}
            </p>
          </InfoCard>
        )}
      </div>
    </div>
  )
}

/** Start / Stop / Restart, shared by the overview header and nowhere else. */
function RunControls({ project }: { project: Project }): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const start = useApp((s) => s.start)
  const stop = useApp((s) => s.stop)
  const restart = useApp((s) => s.restart)
  const refreshThumb = useApp((s) => s.refreshThumb)
  const busy = isBusy(runtime.status)
  const live = isLive(runtime.status)

  if (!live) {
    return (
      <Button variant="primary" icon="play" disabled={busy} onClick={() => void start(project.id)}>
        {runtime.status === 'installing' ? 'Installing…' : runtime.status === 'crashed' ? 'Try again' : 'Start'}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-[6px]">
      {runtime.status === 'running' && (
        <Button
          variant="subtle"
          size="sm"
          icon="preview"
          onClick={() => void refreshThumb(project.id)}
          title="Take a new preview image for the home screen"
        >
          Recapture
        </Button>
      )}
      {!runtime.external && (
        <Button icon="restart" disabled={busy} onClick={() => void restart(project.id)}>
          Restart
        </Button>
      )}
      <Button
        variant="solid"
        icon="stop"
        disabled={busy}
        onClick={() => void stop(project.id)}
        title={runtime.external ? 'Stop showing this server here. It keeps running.' : undefined}
      >
        {runtime.status === 'stopping' ? 'Stopping…' : runtime.external ? 'Detach' : 'Stop'}
      </Button>
    </div>
  )
}

function StatusBar({ project }: { project: Project }): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const notify = useApp((s) => s.notify)

  return (
    <div className="flex min-h-[48px] flex-wrap items-center gap-x-[14px] gap-y-[6px] px-[24px] py-[12px]">
      <span className="flex items-center gap-[7px] text-ui font-medium">
        <StatusDot status={runtime.status} />
        {STATUS_LABELS[runtime.status]}
      </span>

      {runtime.url && (
        <span className="flex min-w-0 items-center gap-[2px]">
          <button
            type="button"
            onClick={() => void window.devlaunchr.system.openExternal(runtime.url as string)}
            className="flex min-w-0 items-center gap-[6px] rounded-[8px] px-[8px] py-[3px] font-mono text-caption text-accent-text hover:bg-accent-soft"
            title="Open in your browser"
          >
            <span className="truncate">{runtime.url}</span>
            <Icon name="external" size={12} />
          </button>
          <button
            type="button"
            aria-label="Copy address"
            title="Copy address"
            onClick={() =>
              void navigator.clipboard.writeText(runtime.url as string).then(() => notify('Address copied.', 'success'))
            }
            className="flex size-[24px] items-center justify-center rounded-[8px] text-ink-muted hover:bg-hover hover:text-ink"
          >
            <Icon name="copy" size={13} />
          </button>
        </span>
      )}

      {runtime.pid !== null && <span className="font-mono text-micro text-ink-muted">pid {runtime.pid}</span>}
      <Uptime startedAt={runtime.status === 'running' ? runtime.startedAt : null} />
    </div>
  )
}

/** Every reason this project cannot run right now, each with its fix. */
function Problems({ project, missingTools }: { project: Project; missingTools: Requirement[] }): React.JSX.Element | null {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const platform = useApp((s) => s.info?.platform)
  const install = useApp((s) => s.install)
  const start = useApp((s) => s.start)
  const openPorts = useApp((s) => s.openPorts)
  const copy = platformCopy(platform)
  const installing = runtime.status === 'installing'

  const items: React.ReactNode[] = []

  if (runtime.external) {
    items.push(
      <Callout
        key="external"
        tone="accent"
        title="Running outside devLaunchr"
        actions={
          <Button
            size="sm"
            onClick={async () => {
              const owner = runtime.external
              if (!owner || runtime.port === null) return
              const freed = await window.devlaunchr.system.freePort(owner.pid, runtime.port, owner.command)
              if (freed) void window.devlaunchr.runtime.detectExternal()
            }}
          >
            Quit it…
          </Button>
        }
      >
        Started by {runtime.external.command} (pid {runtime.external.pid}). devLaunchr attached to it instead of
        starting a second copy.
      </Callout>
    )
  }

  if (installing) {
    items.push(
      <Callout key="installing" tone="info" title="Installing dependencies…">
        Output is streaming into the log below. The project starts on its own once this finishes.
      </Callout>
    )
  }

  if (!installing && missingTools.length > 0) {
    items.push(<RequirementsPanel key="requirements" projectId={project.id} requirements={missingTools} />)
  }

  if (!installing && runtime.diagnosis) {
    items.push(<DiagnosisPanel key="diagnosis" project={project} diagnosis={runtime.diagnosis} />)
  }

  if (!installing && runtime.needsInstall && !runtime.diagnosis) {
    items.push(
      <Callout
        key="install"
        tone="warn"
        title="Dependencies are not installed"
        actions={
          <Button size="sm" variant="solid" onClick={() => void install(project.id)}>
            Run {project.installCommand ?? 'install'}
          </Button>
        }
      >
        This project has no installed dependencies yet, so{' '}
        <code className="font-mono text-ink">{project.startCommand}</code> has nothing to run.
      </Callout>
    )
  }

  if (runtime.conflict && runtime.status === 'crashed' && !runtime.diagnosis) {
    const conflict = runtime.conflict
    items.push(
      <Callout
        key="conflict"
        tone="danger"
        title={`Port ${conflict.port} is already in use`}
        actions={
          <>
            {conflict.pid !== null && (
              <Button
                size="sm"
                variant="solid"
                onClick={async () => {
                  if (!conflict.pid) return
                  const freed = await window.devlaunchr.system.freePort(
                    conflict.pid,
                    conflict.port,
                    conflict.command ?? 'that process'
                  )
                  if (freed) void start(project.id)
                }}
              >
                Free port and start
              </Button>
            )}
            <Button size="sm" icon="ports" onClick={openPorts}>
              See all ports
            </Button>
          </>
        }
      >
        {conflict.command
          ? `Held by ${conflict.command} (pid ${conflict.pid}), which devLaunchr did not start.`
          : `Another process on ${copy.computer} is holding it.`}
        {conflict.hardcoded && ' This project pins the port in its own start command, so devLaunchr cannot move it.'}
      </Callout>
    )
  }

  if (
    runtime.lastError &&
    runtime.status === 'crashed' &&
    !runtime.needsInstall &&
    !runtime.conflict &&
    !runtime.diagnosis
  ) {
    items.push(
      <Callout key="error" tone="danger" title="The server stopped unexpectedly">
        <span className="selectable">{runtime.lastError}</span>
      </Callout>
    )
  }

  if (items.length === 0) return null
  return <div className="flex flex-col gap-[8px] px-[20px] pb-[12px]">{items}</div>
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-[10px] rounded-card border border-hairline bg-recessed p-[14px]">
      <h2 className="eyebrow">{title}</h2>
      <div className="flex flex-col gap-[8px]">{children}</div>
    </section>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[72px_1fr] items-baseline gap-[10px] text-ui">
      <span className="text-caption text-ink-muted">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  )
}

export function Uptime({ startedAt }: { startedAt: number | null }): React.JSX.Element | null {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (startedAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  if (startedAt === null) return null
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const text =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
        : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`

  return <span className="font-mono text-micro text-ink-muted">up {text}</span>
}
