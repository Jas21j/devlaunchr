import { useCallback, useEffect, useState } from 'react'
import type { ListeningPort } from '@shared/ipc'
import { useApp } from '../store'
import { Button } from './Button'
import { StatusDot } from './StatusDot'

/**
 * Every TCP port this Mac is listening on — not just the ones devLaunchr
 * started. The useful question when a port is taken is "what is holding it",
 * and that answer lives outside this app.
 */
export function PortsPanel(): React.JSX.Element | null {
  const open = useApp((s) => s.portsOpen)
  const close = useApp((s) => s.closePorts)
  const stop = useApp((s) => s.stop)
  const select = useApp((s) => s.select)

  const [listeners, setListeners] = useState<ListeningPort[] | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setListeners(await window.devlaunchr.system.listeners())
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, refresh, close])

  if (!open) return null

  const ours = listeners?.filter((entry) => entry.projectId !== null) ?? []
  const others = listeners?.filter((entry) => entry.projectId === null) ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-[24px]"
      style={{ background: 'rgba(9, 9, 11, 0.32)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        className="flex max-h-full w-[580px] flex-col overflow-hidden rounded-panel bg-raised"
        style={{ boxShadow: 'var(--shadow-overlay)' }}
      >
        <header className="flex shrink-0 items-center justify-between gap-[12px] border-b border-hairline px-[20px] py-[14px]">
          <div className="flex flex-col gap-[2px]">
            <h2 className="text-subheading font-semibold tracking-[-0.01em]">Listening ports</h2>
            <p className="text-caption text-ink-muted">
              {listeners === null
                ? 'Scanning…'
                : `${listeners.length} on this Mac · ${ours.length} started by devLaunchr`}
            </p>
          </div>
          <div className="flex items-center gap-[8px]">
            <Button disabled={busy} onClick={() => void refresh()}>
              {busy ? 'Scanning…' : 'Refresh'}
            </Button>
            <Button variant="subtle" onClick={close}>
              Done
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {ours.length > 0 && (
            <Group label="Started by devLaunchr">
              {ours.map((entry) => (
                <Row
                  key={`${entry.pid}-${entry.port}`}
                  entry={entry}
                  action={
                    <Button
                      className="h-[22px] px-[8px] text-micro"
                      onClick={() => {
                        if (entry.projectId) void stop(entry.projectId)
                        void refresh()
                      }}
                    >
                      Stop
                    </Button>
                  }
                  onOpenProject={() => {
                    if (!entry.projectId) return
                    select(entry.projectId)
                    close()
                  }}
                />
              ))}
            </Group>
          )}

          {others.length > 0 && (
            <Group label="Other processes">
              {others.map((entry) => (
                <Row
                  key={`${entry.pid}-${entry.port}`}
                  entry={entry}
                  action={
                    <Button
                      className="h-[22px] px-[8px] text-micro"
                      onClick={async () => {
                        const freed = await window.devlaunchr.system.freePort(
                          entry.pid,
                          entry.port,
                          entry.command
                        )
                        if (freed) void refresh()
                      }}
                    >
                      Quit…
                    </Button>
                  }
                />
              ))}
            </Group>
          )}

          {listeners !== null && listeners.length === 0 && (
            <p className="p-[20px] text-ui text-ink-muted">Nothing is listening right now.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col">
      <h3 className="sticky top-0 z-10 bg-raised px-[20px] pb-[4px] pt-[14px] text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </h3>
      <div className="flex flex-col px-[12px] pb-[8px]">{children}</div>
    </section>
  )
}

function Row({
  entry,
  action,
  onOpenProject
}: {
  entry: ListeningPort
  action: React.ReactNode
  onOpenProject?: () => void
}): React.JSX.Element {
  const url = entry.url

  return (
    <div className="group flex items-center gap-[10px] rounded-card px-[8px] py-[7px] hover:bg-[var(--surface-hover)]">
      {entry.projectId ? <StatusDot status="running" /> : <span className="w-[7px]" />}

      <code className="w-[54px] shrink-0 font-mono text-ui text-ink">{entry.port}</code>

      <button
        type="button"
        onClick={onOpenProject}
        disabled={!onOpenProject}
        className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-default"
      >
        <span className="truncate text-ui text-ink">{entry.projectName ?? entry.command}</span>
        <span className="truncate font-mono text-micro text-ink-muted">
          pid {entry.pid} · {entry.address}
          {entry.projectName ? ` · ${entry.command}` : ''}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-[6px] opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => void window.devlaunchr.system.openExternal(url)}
          className="rounded-badge border border-hairline px-[8px] py-[2px] text-micro text-ink-secondary hover:bg-[var(--surface-hover)]"
        >
          Open
        </button>
        {action}
      </div>
    </div>
  )
}
