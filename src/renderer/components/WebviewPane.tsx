import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { runtimeOf, useApp } from '../store'
import { StatusDot } from './StatusDot'
import { Button } from './Button'

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

const DEVICE_PRESETS = [
  { label: 'Full', width: null },
  { label: '1024', width: 1024 },
  { label: '768', width: 768 },
  { label: '390', width: 390 }
] as const

export function WebviewPane({
  project,
  onShowDetails
}: {
  project: Project
  onShowDetails: () => void
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
  const busy = runtime.status === 'starting' || runtime.status === 'stopping'

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
      <header className="flex h-[40px] shrink-0 items-center gap-[6px] border-b border-hairline px-[10px]">
        <StatusDot status={runtime.status} />

        <IconButton label="Back" disabled={!live || !nav.back} onClick={() => frame.current?.goBack()}>
          <path d="M9.5 3 L5 7.5 L9.5 12" />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!live || !nav.forward}
          onClick={() => frame.current?.goForward()}
        >
          <path d="M5.5 3 L10 7.5 L5.5 12" />
        </IconButton>
        <IconButton
          label={loading ? 'Stop loading' : 'Reload'}
          disabled={!live}
          onClick={(event) => {
            const view = frame.current
            if (!view) return
            // Alt-click bypasses the cache, the way every browser does it.
            if (event.altKey) view.reloadIgnoringCache()
            else view.reload()
          }}
        >
          <path d="M12 7.5 A4.5 4.5 0 1 1 10.4 4" />
          <path d="M12.4 1.6 L12.4 4.4 L9.6 4.4" />
        </IconButton>

        <input
          value={address}
          disabled={!live}
          spellCheck={false}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false)
            setAddress(frame.current?.getURL() ?? runtime.url ?? '')
          }}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            go(address)
            event.currentTarget.blur()
          }}
          className="h-[24px] min-w-0 flex-1 rounded-control border border-hairline bg-recessed px-[9px] font-mono text-micro text-ink placeholder:text-ink-placeholder focus:outline-none disabled:text-ink-placeholder"
          placeholder={live ? '' : 'Not running'}
        />

        <div className="flex shrink-0 items-center gap-[1px] rounded-control border border-hairline p-[1px]">
          {DEVICE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={!live}
              onClick={() => setDeviceWidth(preset.width)}
              className="rounded-[10px] px-[7px] py-[2px] text-micro transition-colors disabled:opacity-40"
              style={{
                background: deviceWidth === preset.width ? 'var(--surface-active)' : undefined,
                color: deviceWidth === preset.width ? 'var(--text-primary)' : 'var(--text-muted)'
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <IconButton
          label="Developer tools"
          disabled={!live}
          onClick={() => {
            const view = frame.current
            if (!view) return
            if (view.isDevToolsOpened()) view.closeDevTools()
            else view.openDevTools()
          }}
        >
          <path d="M5.5 5 L3 7.5 L5.5 10" />
          <path d="M9.5 5 L12 7.5 L9.5 10" />
        </IconButton>
        <IconButton label="Project details" onClick={onShowDetails}>
          <circle cx="7.5" cy="7.5" r="5.5" />
          <path d="M7.5 6.8 V10.5" />
          <path d="M7.5 4.6 V5" />
        </IconButton>
        <IconButton
          label="Open in browser"
          disabled={!runtime.url}
          onClick={() => {
            if (runtime.url) void window.devlaunchr.system.openExternal(runtime.url)
          }}
        >
          <path d="M6 3 H3 V12 H12 V9" />
          <path d="M8 7.5 L12.5 3" />
          <path d="M9 2.5 H13 V6.5" />
        </IconButton>

        <div className="mx-[2px] h-[18px] w-px shrink-0" style={{ background: 'var(--border-hairline)' }} />

        {live || busy ? (
          <>
            <Button
              className="h-[24px] px-[9px] text-micro"
              disabled={busy}
              onClick={() => void restart(project.id)}
            >
              Restart
            </Button>
            <Button
              variant="primary"
              className="h-[24px] px-[9px] text-micro"
              disabled={busy}
              onClick={() => void stop(project.id)}
            >
              {runtime.status === 'stopping' ? 'Stopping…' : 'Stop'}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            className="h-[24px] px-[9px] text-micro"
            onClick={() => void start(project.id)}
          >
            Start
          </Button>
        )}
      </header>

      <div className="relative min-h-0 flex-1" style={{ background: 'var(--surface-recessed)' }}>
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
              className="h-full border-0"
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
            <p
              className="pointer-events-auto mx-auto w-fit rounded-badge border border-hairline bg-raised px-[10px] py-[4px] text-caption"
              style={{ color: 'var(--status-crashed)' }}
            >
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
    <div className="flex h-full flex-col items-center justify-center gap-[10px] px-[24px] text-center">
      {status === 'starting' ? (
        <p className="text-ui text-ink-secondary">Waiting for the server to answer…</p>
      ) : status === 'crashed' ? (
        <>
          <p className="text-ui" style={{ color: 'var(--status-crashed)' }}>
            {error ?? 'The server stopped unexpectedly.'}
          </p>
          <Button onClick={onStart}>Try again</Button>
        </>
      ) : (
        <>
          <p className="text-ui text-ink-muted">This project is not running.</p>
          <Button variant="primary" onClick={onStart}>
            Start
          </Button>
        </>
      )}
    </div>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: (event: React.MouseEvent) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-[24px] shrink-0 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}
