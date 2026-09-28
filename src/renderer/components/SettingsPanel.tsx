import { useEffect, useState } from 'react'
import type { EditorId, Settings, ThemePreference } from '@shared/types'
import { useApp, type SettingsSection } from '../store'
import { tildePath, platformCopy } from '../labels'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { Field, Input, Select, Toggle } from './form'
import { Modal } from './Modal'
import { BrandMark, Segmented } from './ui'

const EDITOR_NAMES: Record<EditorId, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  zed: 'Zed',
  sublime: 'Sublime Text',
  custom: 'Custom command'
}

/** The name used in "Open in …" labels. */
export const editorName = (settings: Pick<Settings, 'editor'>): string =>
  settings.editor === 'custom' ? 'editor' : EDITOR_NAMES[settings.editor]

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: 'appearance', label: 'Appearance', icon: 'preview' },
  { id: 'projects', label: 'Scanning', icon: 'scan' },
  { id: 'servers', label: 'Servers', icon: 'terminal' },
  { id: 'editor', label: 'Editor', icon: 'code' },
  { id: 'system', label: 'System', icon: 'settings' },
  { id: 'about', label: 'About', icon: 'info' }
]

const TIMEOUTS = [15_000, 30_000, 60_000, 120_000, 300_000]
const IDLE_OPTIONS: Array<number | null> = [null, 15, 30, 60, 120, 240]

const seconds = (ms: number): string => (ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`)

export function SettingsPanel(): React.JSX.Element | null {
  const open = useApp((s) => s.settingsOpen)
  const close = useApp((s) => s.closeSettings)
  const section = useApp((s) => s.settingsSection)
  const openSection = useApp((s) => s.openSettings)
  const settings = useApp((s) => s.settings)

  if (!open || !settings) return null

  return (
    <Modal label="Settings" width={780} onClose={close}>
      <div className="flex h-[min(580px,calc(100vh-96px))] min-h-0">
        <nav className="flex w-[196px] shrink-0 flex-col gap-[2px] border-r border-hairline bg-recessed p-[10px]">
          <h2 className="px-[10px] pb-[10px] pt-[6px] text-subheading font-semibold tracking-[-0.01em]">Settings</h2>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openSection(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
              className={`flex h-[32px] items-center gap-[9px] rounded-[10px] px-[10px] text-left text-ui transition-colors ${
                section === item.id ? 'bg-raised font-medium text-ink' : 'text-ink-secondary hover:bg-hover hover:text-ink'
              }`}
              style={section === item.id ? { boxShadow: '0 0 0 1px var(--border-hairline)' } : undefined}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-[24px] pb-[4px] pt-[20px]">
            <h3 className="text-body font-semibold">{SECTIONS.find((item) => item.id === section)?.label}</h3>
            <Button variant="subtle" size="sm" iconOnly icon="close" aria-label="Close settings" onClick={close} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-[24px] pb-[24px] pt-[12px]">
            {section === 'appearance' && <Appearance />}
            {section === 'projects' && <Scanning settings={settings} />}
            {section === 'servers' && <Servers settings={settings} />}
            {section === 'editor' && <Editor settings={settings} />}
            {section === 'system' && <System settings={settings} />}
            {section === 'about' && <About />}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Group({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-col gap-[18px]">{children}</div>
}

function Appearance(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const setTheme = useApp((s) => s.setTheme)
  const platform = useApp((s) => s.info?.platform)

  return (
    <Group>
      <Field
        label="Theme"
        hint={`System follows ${platformCopy(platform).isMac ? 'macOS' : 'your operating system'} and switches with it.`}
      >
        <div>
          <Segmented<ThemePreference>
            label="Theme"
            value={settings?.theme ?? 'system'}
            onChange={(theme) => void setTheme(theme)}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
          />
        </div>
      </Field>
    </Group>
  )
}

function Scanning({ settings }: { settings: Settings }): React.JSX.Element {
  const update = useApp((s) => s.updateSettings)
  const startScan = useApp((s) => s.startScan)
  const home = useApp((s) => s.info?.home ?? '')

  const addRoot = async (): Promise<void> => {
    const picked = await window.devlaunchr.system.pickDirectory('Add a folder to scan')
    if (picked && !settings.watchRoots.includes(picked)) {
      await update({ watchRoots: [...settings.watchRoots, picked] })
    }
  }

  return (
    <Group>
      <Field label="Scan folders" hint="A scan walks each of these looking for runnable projects. Nothing is added without your confirmation.">
        <div className="flex flex-col overflow-hidden rounded-card border border-hairline">
          {settings.watchRoots.length === 0 && (
            <p className="px-[12px] py-[10px] text-caption text-ink-muted">No folders. Add the ones you keep code in.</p>
          )}
          {settings.watchRoots.map((root) => (
            <div key={root} className="group flex items-center gap-[10px] border-b border-hairline px-[12px] py-[8px] last:border-b-0">
              <Icon name="folder" size={14} className="text-ink-muted" />
              <span className="selectable min-w-0 flex-1 truncate font-mono text-caption" title={root}>
                {tildePath(root, home)}
              </span>
              <button
                type="button"
                aria-label={`Stop scanning ${root}`}
                title="Remove"
                onClick={() => void update({ watchRoots: settings.watchRoots.filter((entry) => entry !== root) })}
                className="flex size-[22px] items-center justify-center rounded-[7px] text-ink-muted opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Icon name="close" size={11} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      </Field>
      <div className="-mt-[8px] flex items-center gap-[8px]">
        <Button size="sm" icon="plus" onClick={() => void addRoot()}>
          Add folder
        </Button>
        <Button size="sm" icon="scan" variant="subtle" onClick={() => void startScan()}>
          Scan now
        </Button>
      </div>

      <Field label="Scan depth" hint="How many folders deep to look below each scan folder. Deeper finds more and takes longer.">
        <Select
          className="w-[180px]"
          value={settings.scanMaxDepth}
          onChange={(event) => void update({ scanMaxDepth: Number(event.target.value) })}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((depth) => (
            <option key={depth} value={depth}>
              {depth} level{depth === 1 ? '' : 's'}
            </option>
          ))}
        </Select>
      </Field>
    </Group>
  )
}

function Servers({ settings }: { settings: Settings }): React.JSX.Element {
  const update = useApp((s) => s.updateSettings)
  const [start, setStart] = useState(String(settings.portRangeStart))
  const [end, setEnd] = useState(String(settings.portRangeEnd))

  useEffect(() => {
    setStart(String(settings.portRangeStart))
    setEnd(String(settings.portRangeEnd))
  }, [settings.portRangeStart, settings.portRangeEnd])

  const valid = (value: string): boolean => {
    const port = Number(value)
    return Number.isInteger(port) && port >= 1024 && port <= 65535
  }
  const rangeError = !valid(start) || !valid(end) ? 'Use ports between 1024 and 65535.' : null

  const commitRange = (): void => {
    if (rangeError) return
    const a = Number(start)
    const b = Number(end)
    if (a !== settings.portRangeStart || b !== settings.portRangeEnd) {
      void update({ portRangeStart: Math.min(a, b), portRangeEnd: Math.max(a, b) })
    }
  }

  return (
    <Group>
      <Field
        label="Port range"
        hint={
          rangeError ? (
            <span className="text-danger">{rangeError}</span>
          ) : (
            'Projects without a preferred port get the first free one in this range.'
          )
        }
      >
        <div className="flex items-center gap-[8px]">
          <Input
            mono
            inputMode="numeric"
            aria-label="First port"
            className="!w-[100px]"
            value={start}
            onChange={(event) => setStart(event.target.value.replace(/[^0-9]/g, ''))}
            onBlur={commitRange}
            onKeyDown={(event) => event.key === 'Enter' && commitRange()}
          />
          <span className="text-ink-muted">to</span>
          <Input
            mono
            inputMode="numeric"
            aria-label="Last port"
            className="!w-[100px]"
            value={end}
            onChange={(event) => setEnd(event.target.value.replace(/[^0-9]/g, ''))}
            onBlur={commitRange}
            onKeyDown={(event) => event.key === 'Enter' && commitRange()}
          />
        </div>
      </Field>

      <Field label="Startup timeout" hint="How long to wait for a server to answer before calling the start a failure.">
        <Select
          className="w-[180px]"
          value={settings.healthCheckTimeoutMs}
          onChange={(event) => void update({ healthCheckTimeoutMs: Number(event.target.value) })}
        >
          {[...new Set([...TIMEOUTS, settings.healthCheckTimeoutMs])]
            .sort((a, b) => a - b)
            .map((ms) => (
              <option key={ms} value={ms}>
                {seconds(ms)}
              </option>
            ))}
        </Select>
      </Field>

      <Field label="Stop idle servers" hint="Stops a server devLaunchr started once it has written no output and has not been on screen for this long. Servers started elsewhere are never stopped.">
        <Select
          className="w-[180px]"
          value={settings.autoStopIdleMinutes ?? ''}
          onChange={(event) =>
            void update({ autoStopIdleMinutes: event.target.value === '' ? null : Number(event.target.value) })
          }
        >
          {[...new Set([...IDLE_OPTIONS, settings.autoStopIdleMinutes])].map((minutes) => (
            <option key={minutes ?? 'off'} value={minutes ?? ''}>
              {minutes === null ? 'Never' : minutes < 60 ? `After ${minutes} min` : `After ${minutes / 60} h`}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Default package manager"
        hint="Used for Node projects that declare no package manager and have no lockfile."
      >
        <div>
          <Segmented<Settings['defaultPackageManager']>
            label="Default package manager"
            value={settings.defaultPackageManager}
            onChange={(defaultPackageManager) => void update({ defaultPackageManager })}
            options={(['npm', 'pnpm', 'yarn', 'bun'] as const).map((pm) => ({ value: pm, label: pm }))}
          />
        </div>
      </Field>

      <div className="flex flex-col px-[8px]">
        <Toggle
          checked={settings.autoInstall}
          onChange={(autoInstall) => void update({ autoInstall })}
          label="Install dependencies automatically"
          hint="Runs the project's install command before starting it when dependencies are missing."
        />
      </div>
    </Group>
  )
}

function Editor({ settings }: { settings: Settings }): React.JSX.Element {
  const update = useApp((s) => s.updateSettings)
  const [command, setCommand] = useState(settings.editorCustomCommand)

  useEffect(() => setCommand(settings.editorCustomCommand), [settings.editorCustomCommand])

  return (
    <Group>
      <Field label="Open projects in" hint="Used by “Open in editor” on a project and in its right-click menu.">
        <Select
          className="w-[240px]"
          value={settings.editor}
          onChange={(event) => void update({ editor: event.target.value as EditorId })}
        >
          {(Object.keys(EDITOR_NAMES) as EditorId[]).map((id) => (
            <option key={id} value={id}>
              {EDITOR_NAMES[id]}
            </option>
          ))}
        </Select>
      </Field>

      {settings.editor === 'custom' && (
        <Field
          label="Command"
          hint={
            <>
              Runs in your shell. <code className="font-mono text-ink">{'{path}'}</code> is replaced with the project
              folder; without it, the folder is added at the end.
            </>
          }
        >
          <Input
            mono
            placeholder="idea {path}"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onBlur={() => command !== settings.editorCustomCommand && void update({ editorCustomCommand: command })}
            onKeyDown={(event) => event.key === 'Enter' && void update({ editorCustomCommand: command })}
          />
        </Field>
      )}
    </Group>
  )
}

function System({ settings }: { settings: Settings }): React.JSX.Element {
  const update = useApp((s) => s.updateSettings)
  const supported = useApp((s) => s.info?.loginItemSupported ?? false)

  return (
    <Group>
      <div className="flex flex-col px-[8px]">
        <Toggle
          checked={settings.launchAtLogin}
          disabled={!supported}
          onChange={(launchAtLogin) => void update({ launchAtLogin })}
          label="Open devLaunchr at login"
          hint={
            supported
              ? 'Starts in the background when you log in, so it can clean up anything a previous session left running.'
              : 'Not available on this platform. Add devLaunchr to your desktop’s startup applications instead.'
          }
        />
      </div>
    </Group>
  )
}

function About(): React.JSX.Element {
  const info = useApp((s) => s.info)
  const notify = useApp((s) => s.notify)
  const repo = 'https://github.com/Jas21j/devlaunchr'

  return (
    <Group>
      <div className="flex items-center gap-[14px]">
        <span className="flex size-[52px] items-center justify-center rounded-[15px] bg-[var(--color-obsidian)]">
          <BrandMark height={18} color="var(--color-launch)" />
        </span>
        <div className="flex flex-col gap-[2px]">
          <span className="text-body font-semibold">devLaunchr {info?.version}</span>
          <span className="text-caption text-ink-muted">
            Electron {info?.electronVersion} · {info?.platform}
          </span>
        </div>
      </div>

      <p className="text-ui leading-[1.5] text-ink-secondary">
        A local dev portal. No telemetry, no analytics, no cloud calls — everything runs against loopback on this
        machine. Free and open source under the MIT license.
      </p>

      <Field label="Settings file">
        <div className="flex items-center gap-[8px]">
          <code className="selectable min-w-0 flex-1 truncate rounded-control border border-hairline bg-recessed px-[10px] py-[7px] font-mono text-caption">
            {info?.configPath}
          </code>
          <Button
            size="sm"
            icon="copy"
            onClick={() =>
              info && void navigator.clipboard.writeText(info.configPath).then(() => notify('Path copied.', 'success'))
            }
          >
            Copy
          </Button>
        </div>
      </Field>

      <div className="flex flex-wrap gap-[8px]">
        <Button size="sm" icon="external" onClick={() => void window.devlaunchr.system.openExternal(repo)}>
          GitHub
        </Button>
        <Button
          size="sm"
          icon="external"
          onClick={() => void window.devlaunchr.system.openExternal(`${repo}/releases`)}
        >
          Release notes
        </Button>
        <Button
          size="sm"
          icon="external"
          onClick={() => void window.devlaunchr.system.openExternal(`${repo}/issues/new/choose`)}
        >
          Report an issue
        </Button>
      </div>
    </Group>
  )
}
