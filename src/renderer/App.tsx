import { useEffect, useRef } from 'react'
import type { AppInfo, Project } from '@shared/types'
import type { Requirement } from '@shared/ipc'
import { useState } from 'react'
import { useTheme } from './useTheme'
import { bindMainProcessEvents, runtimeOf, useApp } from './store'
import { openContextMenu } from './actions'
import { Sidebar } from './components/Sidebar'
import { ProjectEditor } from './components/ProjectEditor'
import { ScanReview } from './components/ScanReview'
import { LogPane } from './components/LogPane'
import { TabBar } from './components/TabBar'
import { WebviewPane } from './components/WebviewPane'
import { ProjectGrid } from './components/ProjectGrid'
import { DiagnosisPanel } from './components/DiagnosisPanel'
import { RequirementsPanel } from './components/RequirementsPanel'
import { PortsPanel } from './components/PortsPanel'
import { Button } from './components/Button'
import { StatusDot } from './components/StatusDot'
import { TYPE_LABELS, tildePath } from './labels'
import markUrl from './assets/mark.png'

export default function App(): React.JSX.Element {
  useTheme()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const load = useApp((s) => s.load)

  useEffect(() => {
    void window.devlaunchr.app.info().then(setInfo)
    void load()
    const unbind = bindMainProcessEvents()

    // Servers come and go in terminals while this window sits in the
    // background, so the picture is refreshed whenever it comes forward again.
    const onFocus = (): void => void window.devlaunchr.runtime.detectExternal()
    window.addEventListener('focus', onFocus)

    return () => {
      window.removeEventListener('focus', onFocus)
      unbind()
    }
  }, [load])

  // First run: go straight to a scan so the app is useful immediately. The
  // review screen still adds nothing without confirmation, and the flag means
  // this happens exactly once.
  const settings = useApp((s) => s.settings)
  const projectCount = useApp((s) => s.projects.length)
  const startScan = useApp((s) => s.startScan)
  const firstRunDone = useRef(false)

  useEffect(() => {
    if (firstRunDone.current) return
    if (!settings || settings.hasCompletedFirstScan || projectCount > 0) return
    firstRunDone.current = true
    void startScan()
  }, [settings, projectCount, startScan])

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <TitleBar isMac={info?.platform === 'darwin'} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-[10px] p-[12px] pl-0">
          <TabBar />
          <Detail home={info?.home ?? ''} />
        </main>
      </div>
      <ProjectEditor home={info?.home ?? ''} />
      <ScanReview home={info?.home ?? ''} />
      <PortsPanel />
      <ErrorToast />
    </div>
  )
}

function TitleBar({ isMac }: { isMac: boolean }): React.JSX.Element {
  const count = useApp((s) => s.projects.length)
  const startScan = useApp((s) => s.startScan)
  const selectedId = useApp((s) => s.selectedId)
  const select = useApp((s) => s.select)
  const openPorts = useApp((s) => s.openPorts)
  const resync = useApp((s) => s.resync)
  const resyncing = useApp((s) => s.resyncing)

  return (
    <header
      className="drag-region flex h-[var(--titlebar-height)] shrink-0 items-center justify-between gap-[12px] pr-[12px]"
      // Only macOS overlays its window controls on our header; elsewhere the
      // system draws its own title bar and this gutter would be dead space.
      style={{ paddingLeft: isMac ? 88 : 16 }}
    >
      <div className="flex items-center gap-[8px]">
        <BrandMark />
        <span className="text-ui font-semibold tracking-[-0.01em]">devLaunchr</span>
        {count > 0 && (
          <span className="text-micro text-ink-muted">
            {count} project{count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-[8px]">
        {selectedId && (
          <Button variant="subtle" onClick={() => select(null)}>
            All projects
          </Button>
        )}
        <Button
          variant="subtle"
          disabled={resyncing}
          onClick={() => void resync()}
          title="Re-check what is running and re-take every preview image"
        >
          {resyncing ? 'Refreshing…' : 'Refresh'}
        </Button>
        <Button variant="subtle" onClick={openPorts} title="Every port this machine is listening on">
          Ports
        </Button>
        <Button onClick={() => void startScan()}>Scan</Button>
        <Button variant="subtle" disabled title="Settings land in build step 7">
          Settings
        </Button>
      </div>
    </header>
  )
}

/** Stable identity so a project with nothing missing does not re-render. */
const NO_REQUIREMENTS: Requirement[] = []

/** The mark's aspect ratio, so its box never distorts the artwork. */
const MARK_ASPECT = 320 / 174

/**
 * The mark is a white-on-alpha silhouette used as a CSS mask, so it paints in
 * the current ink colour and stays correct in both themes from one asset.
 */
function BrandMark({ height = 15 }: { height?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0"
      style={{
        height,
        width: Math.round(height * MARK_ASPECT),
        background: 'currentColor',
        maskImage: `url(${markUrl})`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center'
      }}
    />
  )
}

function Detail({ home }: { home: string }): React.JSX.Element {
  const projects = useApp((s) => s.projects)
  const selectedId = useApp((s) => s.selectedId)
  const beginAdd = useApp((s) => s.beginAdd)
  const startScan = useApp((s) => s.startScan)

  const project = projects.find((p) => p.id === selectedId) ?? null

  if (projects.length === 0) {
    return (
      <Panel>
        <div className="flex max-w-[420px] flex-col items-center gap-[12px] text-center">
          <h1 className="text-display font-semibold leading-[1.2] tracking-[-0.02em]">
            No projects yet
          </h1>
          <p className="text-body text-ink-secondary">
            Scan this Mac to find every local site and app project, or add a single
            folder by hand. devLaunchr works out how to run each one.
          </p>
          <div className="mt-[4px] flex items-center gap-[8px]">
            <Button variant="primary" onClick={() => void startScan()}>
              Scan this Mac
            </Button>
            <Button onClick={() => void beginAdd()}>Add a folder</Button>
          </div>
        </div>
      </Panel>
    )
  }

  if (!project) return <ProjectGrid home={home} />

  return <ProjectDetail key={project.id} project={project} home={home} />
}

function ProjectDetail({
  project,
  home
}: {
  project: Project
  home: string
}): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const start = useApp((s) => s.start)
  const stop = useApp((s) => s.stop)
  const restart = useApp((s) => s.restart)
  const beginEdit = useApp((s) => s.beginEdit)
  const openTab = useApp((s) => s.openTab)
  const refreshThumb = useApp((s) => s.refreshThumb)
  const install = useApp((s) => s.install)
  const openPortsPanel = useApp((s) => s.openPorts)
  const missingTools = useApp((s) => s.requirements[project.id]) ?? NO_REQUIREMENTS
  const hasTab = useApp((s) => s.tabs.includes(project.id))

  // Each tab has two faces — the live site and the project's settings. This
  // component is keyed by project id, so the choice resets per project.
  const [showDetails, setShowDetails] = useState(false)

  const envEntries = Object.entries(project.env)
  const busy =
    runtime.status === 'starting' ||
    runtime.status === 'stopping' ||
    runtime.status === 'installing'
  const live = runtime.status === 'running' || runtime.status === 'starting'

  if (hasTab && !showDetails) {
    return (
      <>
        <WebviewPane project={project} onShowDetails={() => setShowDetails(true)} />
        <LogPane projectId={project.id} />
      </>
    )
  }

  return (
    <>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-panel border border-hairline bg-raised"
        onContextMenu={(event) => {
          event.preventDefault()
          void openContextMenu(project)
        }}
      >
        <header className="flex items-start justify-between gap-[16px] border-b border-hairline p-[20px]">
          <div className="flex min-w-0 flex-col gap-[4px]">
            <div className="flex items-center gap-[8px]">
              <StatusDot status={runtime.status} />
              <h1 className="truncate text-section font-semibold tracking-[-0.015em]">
                {project.name}
              </h1>
              <span className="rounded-badge border border-hairline px-[8px] py-[1px] text-caption text-ink-secondary">
                {TYPE_LABELS[project.type]}
              </span>
            </div>
            <p className="selectable truncate font-mono text-caption text-ink-muted">
              {tildePath(project.path, home)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-[8px]">
            {runtime.status === 'running' && (
              <Button onClick={() => void refreshThumb(project.id)} title="Update the preview image">
                Recapture
              </Button>
            )}
            {hasTab && <Button onClick={() => setShowDetails(false)}>Preview</Button>}
            {!hasTab && runtime.status === 'running' && (
              <Button onClick={() => openTab(project.id)}>Open preview</Button>
            )}
            <Button onClick={() => beginEdit(project.id)}>Edit</Button>
            {live ? (
              <>
                {!runtime.external && (
                  <Button disabled={busy} onClick={() => void restart(project.id)}>
                    Restart
                  </Button>
                )}
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void stop(project.id)}
                  title={
                    runtime.external
                      ? 'Stop showing this server here. It keeps running.'
                      : undefined
                  }
                >
                  {runtime.status === 'stopping'
                    ? 'Stopping…'
                    : runtime.external
                      ? 'Detach'
                      : 'Stop'}
                </Button>
              </>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void start(project.id)}>
                Start
              </Button>
            )}
          </div>
        </header>

        {runtime.external && (
          <div className="flex items-center justify-between gap-[12px] border-b border-hairline px-[20px] py-[10px]">
            <div className="flex min-w-0 flex-col">
              <span className="text-ui text-ink">Running outside devLaunchr</span>
              <span className="truncate text-caption text-ink-muted">
                Started by {runtime.external.command} (pid {runtime.external.pid}).
                devLaunchr attached to it instead of starting a second copy.
              </span>
            </div>
            <Button
              className="shrink-0"
              onClick={async () => {
                const owner = runtime.external
                if (!owner || runtime.port === null) return
                const freed = await window.devlaunchr.system.freePort(
                  owner.pid,
                  runtime.port,
                  owner.command
                )
                if (freed) void window.devlaunchr.runtime.detectExternal()
              }}
            >
              Quit it…
            </Button>
          </div>
        )}

        {runtime.url && (
          <div className="flex items-center gap-[10px] border-b border-hairline px-[20px] py-[10px]">
            <button
              type="button"
              onClick={() => void window.devlaunchr.system.openExternal(runtime.url as string)}
              className="truncate rounded-badge border border-hairline px-[10px] py-[3px] font-mono text-caption text-ink hover:bg-[var(--surface-hover)]"
              title="Open in your browser"
            >
              {runtime.url}
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(runtime.url as string)}
              className="rounded-badge px-[8px] py-[3px] text-caption text-ink-muted hover:bg-[var(--surface-hover)] hover:text-ink"
            >
              Copy
            </button>
            <Uptime startedAt={runtime.startedAt} />
          </div>
        )}

        {missingTools.length > 0 && runtime.status !== 'installing' && (
          <RequirementsPanel projectId={project.id} requirements={missingTools} />
        )}

        {runtime.diagnosis && runtime.status !== 'installing' && (
          <DiagnosisPanel project={project} diagnosis={runtime.diagnosis} />
        )}

        {runtime.needsInstall && !runtime.diagnosis && runtime.status !== 'installing' && (
          <div className="flex items-center justify-between gap-[12px] border-b border-hairline px-[20px] py-[12px]">
            <div className="flex min-w-0 flex-col">
              <span className="text-ui text-ink">Dependencies are not installed</span>
              <span className="truncate text-caption text-ink-muted">
                This project has no node_modules yet, so{' '}
                <code className="font-mono">{project.startCommand}</code> has nothing to run.
              </span>
            </div>
            <Button variant="primary" onClick={() => void install(project.id)}>
              Run {project.installCommand ?? 'install'}
            </Button>
          </div>
        )}

        {runtime.status === 'installing' && (
          <div className="border-b border-hairline px-[20px] py-[12px] text-ui text-ink-secondary">
            Installing dependencies… output is in the log below.
          </div>
        )}

        {runtime.conflict && runtime.status === 'crashed' && (
          <div className="flex items-start justify-between gap-[12px] border-b border-hairline px-[20px] py-[12px]">
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="text-ui" style={{ color: 'var(--status-crashed)' }}>
                Port {runtime.conflict.port} is already in use
              </span>
              <span className="text-caption text-ink-muted">
                {runtime.conflict.command
                  ? `Held by ${runtime.conflict.command} (pid ${runtime.conflict.pid}), which devLaunchr did not start.`
                  : 'Another process on this Mac is holding it.'}
                {runtime.conflict.hardcoded &&
                  ' This project pins the port in its own start command, so devLaunchr cannot move it.'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-[8px]">
              <Button onClick={openPortsPanel}>Ports</Button>
              {runtime.conflict.pid !== null && (
                <Button
                  variant="primary"
                  onClick={async () => {
                    const conflict = runtime.conflict
                    if (!conflict?.pid) return
                    const freed = await window.devlaunchr.system.freePort(
                      conflict.pid,
                      conflict.port,
                      conflict.command ?? 'that process'
                    )
                    if (freed) void start(project.id)
                  }}
                >
                  Free port
                </Button>
              )}
            </div>
          </div>
        )}

        {runtime.lastError &&
          runtime.status === 'crashed' &&
          !runtime.needsInstall &&
          !runtime.conflict &&
          !runtime.diagnosis && (
            <div
              className="border-b border-hairline px-[20px] py-[10px] text-caption"
              style={{ color: 'var(--status-crashed)' }}
            >
              {runtime.lastError}
            </div>
          )}

        <dl className="grid grid-cols-[132px_1fr] gap-x-[16px] gap-y-[12px] p-[20px] text-ui">
          <Row label="Start command">
            {project.startCommand ? (
              <code className="selectable font-mono text-caption">{project.startCommand}</code>
            ) : project.type === 'static' ? (
              <span className="text-ink-muted">Built-in static server</span>
            ) : (
              <span style={{ color: 'var(--status-pending)' }}>Not set</span>
            )}
          </Row>
          {project.installCommand && (
            <Row label="Install command">
              <code className="selectable font-mono text-caption">{project.installCommand}</code>
            </Row>
          )}
          <Row label="Port">
            {runtime.port !== null ? (
              <code className="font-mono text-caption">
                {runtime.port}
                {project.preferredPort !== null && project.preferredPort !== runtime.port && (
                  <span className="text-ink-muted"> (preferred {project.preferredPort})</span>
                )}
              </code>
            ) : project.preferredPort === null ? (
              <span className="text-ink-muted">Auto-assigned</span>
            ) : (
              <code className="font-mono text-caption">{project.preferredPort}</code>
            )}
          </Row>
          {runtime.pid !== null && (
            <Row label="Process">
              <code className="font-mono text-caption">pid {runtime.pid}</code>
            </Row>
          )}
          <Row label="Open tab on start">{project.autoOpen ? 'Yes' : 'No'}</Row>
          {envEntries.length > 0 && (
            <Row label="Environment">
              <div className="flex flex-col gap-[2px]">
                {envEntries.map(([key, value]) => (
                  <code key={key} className="selectable font-mono text-caption">
                    {key}={value}
                  </code>
                ))}
              </div>
            </Row>
          )}
          {project.notes && <Row label="Notes">{project.notes}</Row>}
        </dl>
      </div>

      <LogPane projectId={project.id} />
    </>
  )
}

function Uptime({ startedAt }: { startedAt: number | null }): React.JSX.Element | null {
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

  return <span className="ml-auto shrink-0 font-mono text-micro text-ink-muted">up {text}</span>
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function Panel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center rounded-panel border border-hairline bg-raised">
      {children}
    </div>
  )
}

function ErrorToast(): React.JSX.Element | null {
  const error = useApp((s) => s.error)
  const dismiss = useApp((s) => s.dismissError)

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(dismiss, 6000)
    return () => clearTimeout(timer)
  }, [error, dismiss])

  if (!error) return null

  return (
    <button
      type="button"
      onClick={dismiss}
      className="fixed bottom-[16px] left-1/2 z-[60] max-w-[520px] -translate-x-1/2 rounded-card border border-hairline bg-raised px-[16px] py-[10px] text-left text-ui text-ink"
      style={{ boxShadow: 'var(--shadow-overlay)' }}
    >
      {error}
    </button>
  )
}
