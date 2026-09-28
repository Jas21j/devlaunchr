import { useCallback, useEffect, useState } from 'react'
import type { ListeningPort } from '@shared/ipc'
import { useApp } from '../store'
import { platformCopy } from '../labels'
import { Button } from './Button'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'
import { Modal, ModalHeader } from './Modal'

/**
 * Every TCP port this computer is listening on — not just the ones devLaunchr
 * started. The useful question when a port is taken is "what is holding it",
 * and that answer lives outside this app.
 */
export function PortsPanel(): React.JSX.Element | null {
  const open = useApp((s) => s.portsOpen)
  const close = useApp((s) => s.closePorts)
  const stop = useApp((s) => s.stop)
  const select = useApp((s) => s.select)
  const platform = useApp((s) => s.info?.platform)

  const [listeners, setListeners] = useState<ListeningPort[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')

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
    setFilter('')
    void refresh()
  }, [open, refresh])

  if (!open) return null

  const needle = filter.trim().toLowerCase()
  const shown = (listeners ?? []).filter(
    (entry) =>
      !needle ||
      String(entry.port).includes(needle) ||
      entry.command.toLowerCase().includes(needle) ||
      (entry.projectName ?? '').toLowerCase().includes(needle)
  )
  const ours = shown.filter((entry) => entry.projectId !== null)
  const others = shown.filter((entry) => entry.projectId === null)
  const total = listeners?.length ?? 0
  const oursTotal = listeners?.filter((entry) => entry.projectId !== null).length ?? 0

  return (
    <Modal label="Listening ports" width={620} onClose={close}>
      <ModalHeader
        title="Listening ports"
        subtitle={
          listeners === null
            ? 'Reading the socket table…'
            : `${total} on ${platformCopy(platform).computer} · ${oursTotal} started by devLaunchr`
        }
      >
        <label className="relative flex items-center">
          <span className="pointer-events-none absolute left-[9px] text-ink-placeholder">
            <Icon name="search" size={13} />
          </span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Port or process"
            spellCheck={false}
            aria-label="Filter ports"
            className="field h-[30px] w-[160px] pl-[28px]"
          />
        </label>
        <Button
          iconOnly
          icon="refresh"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label="Refresh"
          title="Refresh"
        />
      </ModalHeader>

      <div className="flex min-h-[200px] flex-1 flex-col overflow-y-auto">
        {ours.length > 0 && (
          <Group label="Started by devLaunchr">
            {ours.map((entry) => (
              <Row
                key={`${entry.pid}-${entry.port}-${entry.address}`}
                entry={entry}
                action={
                  <Button
                    size="sm"
                    variant="solid"
                    icon="stop"
                    onClick={() => {
                      if (entry.projectId) void stop(entry.projectId).then(refresh)
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
                key={`${entry.pid}-${entry.port}-${entry.address}`}
                entry={entry}
                action={
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      const freed = await window.devlaunchr.system.freePort(entry.pid, entry.port, entry.command)
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

        {listeners !== null && shown.length === 0 && (
          <p className="p-[24px] text-center text-ui text-ink-muted">
            {needle ? 'Nothing matches that filter.' : 'Nothing is listening right now.'}
          </p>
        )}
      </div>
    </Modal>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col">
      <h3 className="eyebrow sticky top-0 z-10 bg-raised px-[20px] pb-[6px] pt-[14px]">{label}</h3>
      <div className="flex flex-col px-[10px] pb-[8px]">{children}</div>
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
  return (
    <div className="group flex items-center gap-[12px] rounded-[10px] px-[10px] py-[7px] hover:bg-hover">
      {entry.projectId ? <StatusDot status="running" /> : <span className="w-[7px]" />}

      <code
        className={`w-[56px] shrink-0 font-mono text-ui tabular-nums ${entry.projectId ? 'text-accent-text' : 'text-ink'}`}
      >
        {entry.port}
      </code>

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

      <div className="flex shrink-0 items-center gap-[6px] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button size="sm" icon="external" onClick={() => void window.devlaunchr.system.openExternal(entry.url)}>
          Open
        </Button>
        {action}
      </div>
    </div>
  )
}
