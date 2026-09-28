import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { runtimeOf, useApp, isBusy } from '../store'
import { StatusDot } from './StatusDot'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { Segmented } from './ui'

/**
 * The slice of Electron's WebviewTag API this pane uses. React already types
 * the <webview> element itself, but only as a plain DOM node — none of these
 * navigation methods are on it.
 */
interface WebviewElement extends HTMLElement {
  src: string
  reload: () => void
  reloadIgnoringCache: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  loadURL: (url: string) => Promise<void>
  getURL: () => string
  openDevTools: () => void
  closeDevTools: () => void
  isDevToolsOpened: () => boolean
}

const DEVICE_PRESETS: Array<{ label: string; width: number | null; title: string }> = [
  { label: 'Full', width: null, title: 'Fill the pane' },
  { label: '1024', width: 1024, title: 'Laptop, 1024px' },
  { label: '768', width: 768, title: 'Tablet, 768px' },
  { label: '390', width: 390, title: 'Phone, 390px' }
]

export function WebviewPane({
  project,
  toggle
}: {
  project: Project
  /** The Preview / Overview switch, rendered in this pane's toolbar. */
  toggle: React.ReactNode
}): React.JSX.Element {
  const runtime = useApp((s) => runtimeOf(s, project.id))
  const start = useApp((s) => s.start)
  const stop = useApp((s) => s.stop)
  const restart = useApp((s) => s.restart)

  const frame = useRef<WebviewElement | null>(null)
  const [address, setAddress] = useState(runtime.url ?? '')
  const [editing, setEditing] = useState(false)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [loading, setLoading] = useState(false)
  const [deviceWidth, setDeviceWidth] = useState<number | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const live = runtime.status === 'running'
  const busy = isBusy(runtime.status)

  // The webview is only mounted while a server is up, so every listener is
  // attached fresh each time the project starts.
  useEffect(() => {
    const view = frame.current
    if (!view || !live) return

    const syncNav = (): void => {
      setNav({ back: view.canGoBack(), forward: view.canGoForward() })
      if (!editing) setAddress(view.getURL())
    }

    const onStart = (): void => {
      setLoading(true)
      setFailure(null)
    }
    const onStop = (): void => {
      setLoading(false)
      syncNav()
    }
    const onFail = (event: Event): void => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string }
      // -3 is ERR_ABORTED, which every in-page navigation produces.
      if (detail.errorCode === -3) return
      setLoading(false)
      setFailure(detail.errorDescription ?? 'The page failed to load.')
    }

    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-navigate', syncNav)
    view.addEventListener('did-navigate-in-page', syncNav)
    view.addEventListener('did-fail-load', onFail)

    return () => {
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-navigate', syncNav)
      view.removeEventListener('did-navigate-in-page', syncNav)
      view.removeEventListener('did-fail-load', onFail)
    }
  }, [live, editing])

  useEffect(() => {
    if (runtime.url && !editing) setAddress(runtime.url)
  }, [runtime.url, editing])

  const go = useCallback((url: string) => {
    const view = frame.current
    if (!view) return
    const normalized = /^https?:\/\//i.test(url) ? url : `http://${url}`
    void view.loadURL(normalized).catch(() => setFailure('That address could not be loaded.'))
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-hairline bg-raised">
      <header className="flex h-[44px] shrink-0 items-center gap-[4px] border-b border-hairline px-[8px]">
        <IconButton icon="chevronLeft" label="Back" disabled={!live || !nav.back} onClick={() => frame.current?.goBack()} />
        <IconButton
          icon="chevronRight"
          label="Forward"
          disabled={!live || !nav.forward}
          onClick={() => frame.current?.goForward()}
        />
        <IconButton
          icon={loading ? 'close' : 'restart'}
          label={loading ? 'Stop loading' : 'Reload (Alt-click to bypass the cache)'}
          disabled={!live}
          onClick={(event) => {
            const view = frame.current
            if (!view) return
            // Alt-click bypasses the cache, the way every browser does it.
            if (event.altKey) view.reloadIgnoringCache()
            else view.reload()
          }}
        />

        <label className="relative mx-[4px] flex min-w-0 flex-1 items-center">
          <span className="pointer-events-none absolute left-[9px]">
            <StatusDot status={runtime.status} size={6} />
          </span>
          <input
            value={address}
            disabled={!live}
            spellCheck={false}
            aria-label="Address"
            onFocus={(event) => {
              setEditing(true)
              event.currentTarget.select()
            }}
            onBlur={() => {
              setEditing(false)
              setAddress(frame.current?.getURL() ?? runtime.url ?? '')
            }}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.currentTarget.blur()
              if (event.key !== 'Enter') return
              go(address)
              event.currentTarget.blur()
            }}
            className="field selectable h-[28px] bg-recessed pl-[23px] font-mono text-caption"
            placeholder={live ? '' : 'Not running'}
          />
          {loading && (
            <span className="absolute inset-x-[8px] bottom-0 h-[2px] overflow-hidden rounded-pill">
              <span className="block h-full w-1/3 animate-pulse rounded-pill bg-accent" />
            </span>
          )}
        </label>

        <Segmented<number | null>
          label="Viewport width"
          size="sm"
          value={deviceWidth}
          onChange={setDeviceWidth}
          options={DEVICE_PRESETS.map((preset) => ({ value: preset.width, label: preset.label, title: preset.title }))}
        />

        <IconButton
          icon="devtools"
          label="Developer tools"
          disabled={!live}
          onClick={() => {
            const view = frame.current
            if (!view) return
            if (view.isDevToolsOpened()) view.closeDevTools()
            else view.openDevTools()
          }}
        />
        <IconButton
          icon="external"
          label="Open in your browser"
          disabled={!runtime.url}
          onClick={() => {
            if (runtime.url) void window.devlaunchr.system.openExternal(runtime.url)
          }}
        />

        <div className="mx-[4px] h-[18px] w-px shrink-0 bg-hairline" />
        {toggle}
        <div className="mx-[4px] h-[18px] w-px shrink-0 bg-hairline" />

        {live || runtime.status === 'starting' || runtime.status === 'stopping' ? (
          <>
            {!runtime.external && (
              <Button
                size="sm"
                iconOnly
                icon="restart"
                disabled={busy}
                aria-label="Restart server"
                title="Restart server"
                onClick={() => void restart(project.id)}
              />
            )}
            <Button size="sm" variant="solid" icon="stop" disabled={busy} onClick={() => void stop(project.id)}>
              {runtime.status === 'stopping' ? 'Stopping…' : runtime.external ? 'Detach' : 'Stop'}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" icon="play" disabled={busy} onClick={() => void start(project.id)}>
            Start
          </Button>
        )}
      </header>

      <div className="relative min-h-0 flex-1 bg-inset">
        {live && runtime.url ? (
          <div className="absolute inset-0 flex justify-center">
            <webview
              // Keyed by project as well as url. A restarted server can land on
              // a different port, and two different projects can be served on
              // the same one — keying on the url alone would let them share a
              // webview instance.
              key={`${project.id}:${runtime.url}`}
              ref={frame as unknown as React.Ref<HTMLWebViewElement>}
              src={runtime.url}
              /*
               * One storage partition per project, not one for the app.
               *
               * Browser storage is keyed by origin, and every local project is
               * served from 127.0.0.1 — so on a shared partition, two projects
               * that happen to use the same port are the same origin. They then
               * share cache, localStorage, service workers and SPA routing
               * state, and the second project opens showing the first one's
               * site. Per-project partitions make that impossible, and still
               * keep a project's own sign-ins across restarts.
               */
              partition={`persist:project-${project.id}`}
              className="h-full border-0 bg-white"
              style={{
                width: deviceWidth ?? '100%',
                maxWidth: '100%',
                boxShadow: deviceWidth ? '0 0 0 1px var(--border-hairline)' : undefined
              }}
            />
          </div>
        ) : (
          <Placeholder
            status={runtime.status}
            error={runtime.lastError}
            onStart={() => void start(project.id)}
          />
        )}

        {failure && live && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-[10px]">
            <p className="pointer-events-auto mx-auto w-fit rounded-badge bg-raised px-[12px] py-[6px] text-caption text-danger" style={{ boxShadow: 'var(--shadow-overlay)' }}>
              {failure}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Placeholder({
  status,
  error,
  onStart
}: {
  status: string
  error: string | null
  onStart: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[12px] px-[24px] text-center">
      {status === 'starting' ? (
        <>
          <StatusDot status="starting" size={10} />
          <p className="text-ui text-ink-secondary">Waiting for the server to answer…</p>
        </>
      ) : status === 'installing' ? (
        <>
          <StatusDot status="installing" size={10} />
          <p className="text-ui text-ink-secondary">Installing dependencies — progress is in the log below.</p>
        </>
      ) : status === 'stopping' ? (
        <p className="text-ui text-ink-secondary">Stopping…</p>
      ) : status === 'crashed' ? (
        <>
          <p className="max-w-[520px] text-ui text-danger">{error ?? 'The server stopped unexpectedly.'}</p>
          <Button icon="restart" onClick={onStart}>
            Try again
          </Button>
        </>
      ) : (
        <>
          <p className="text-ui text-ink-muted">This project is not running.</p>
          <Button variant="primary" icon="play" onClick={onStart}>
            Start
          </Button>
        </>
      )}
    </div>
  )
}

function IconButton({
  icon,
  label,
  disabled,
  onClick
}: {
  icon: IconName
  label: string
  disabled?: boolean
  onClick: (event: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-[28px] shrink-0 items-center justify-center rounded-[9px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon name={icon} size={15} />
    </button>
  )
}
