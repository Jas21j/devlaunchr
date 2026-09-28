import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectStatus } from '@shared/types'
import { useApp, runtimeOf, isLive } from '../store'
import { disambiguate, TYPE_LABELS } from '../labels'
import { Icon, type IconName } from './Icon'
import { Kbd } from './Button'
import { Modal } from './Modal'
import { StatusDot } from './StatusDot'
import { editorName } from './SettingsPanel'

interface Command {
  id: string
  group: 'Projects' | 'Actions'
  title: string
  hint?: string
  icon?: IconName
  status?: ProjectStatus
  /** Extra words that should match, e.g. a project's path. */
  keywords?: string
  run: () => void
}

/**
 * Scores `text` against `query` as a subsequence match. Contiguous runs and
 * matches at word starts score higher, so "dash" ranks "dashboard-app" above
 * "docs-and-shop". Returns -1 for no match.
 */
export function fuzzyScore(text: string, query: string): number {
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase().replace(/\s+/g, '')
  if (!needle) return 0
  const direct = haystack.indexOf(needle)
  if (direct !== -1) return 1000 - direct * 2 - haystack.length * 0.1

  let score = 0
  let from = 0
  let previous = -2
  for (const char of needle) {
    const index = haystack.indexOf(char, from)
    if (index === -1) return -1
    const wordStart = index === 0 || /[\s\-_/.]/.test(haystack[index - 1] ?? '')
    score += index === previous + 1 ? 8 : wordStart ? 6 : 1
    previous = index
    from = index + 1
  }
  return score - haystack.length * 0.1
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useApp((s) => s.paletteOpen)
  const close = useApp((s) => s.closePalette)
  if (!open) return null
  return <Palette onClose={close} />
}

function Palette({ onClose }: { onClose: () => void }): React.JSX.Element {
  const projects = useApp((s) => s.projects)
  const runtimes = useApp((s) => s.runtimes)
  const settings = useApp((s) => s.settings)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => {
    const state = useApp.getState()
    const labels = disambiguate(projects)
    const done = (fn: () => void) => () => {
      onClose()
      fn()
    }
    const editor = settings ? editorName(settings) : 'editor'
    const out: Command[] = []

    for (const project of projects) {
      const runtime = runtimeOf({ runtimes }, project.id)
      const label = labels.get(project.id) ?? project.name
      const live = isLive(runtime.status)
      out.push({
        id: `open:${project.id}`,
        group: 'Projects',
        title: label,
        hint: runtime.port !== null && live ? `:${runtime.port}` : TYPE_LABELS[project.type],
        status: runtime.status,
        keywords: project.path,
        run: done(() => state.select(project.id))
      })
      out.push(
        live
          ? {
              id: `stop:${project.id}`,
              group: 'Actions',
              title: `${runtime.external ? 'Detach' : 'Stop'} ${label}`,
              icon: 'stop',
              run: done(() => void state.stop(project.id))
            }
          : {
              id: `start:${project.id}`,
              group: 'Actions',
              title: `Start ${label}`,
              icon: 'play',
              run: done(() => {
                state.select(project.id)
                void state.start(project.id)
              })
            }
      )
      out.push({
        id: `editor:${project.id}`,
        group: 'Actions',
        title: `Open ${label} in ${editor}`,
        icon: 'code',
        run: done(() => void state.openInEditor(project.id))
      })
      if (runtime.url) {
        const url = runtime.url
        out.push({
          id: `browser:${project.id}`,
          group: 'Actions',
          title: `Open ${label} in browser`,
          icon: 'external',
          hint: url,
          run: done(() => void window.devlaunchr.system.openExternal(url))
        })
      }
    }

    const theme = settings?.theme ?? 'system'
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    out.push(
      { id: 'home', group: 'Actions', title: 'Go to all projects', icon: 'home', run: done(() => state.select(null)) },
      { id: 'scan', group: 'Actions', title: 'Scan for projects', icon: 'scan', run: done(() => void state.startScan()) },
      { id: 'add', group: 'Actions', title: 'Add a project folder…', icon: 'plus', run: done(() => void state.beginAdd()) },
      { id: 'ports', group: 'Actions', title: 'Show listening ports', icon: 'ports', run: done(() => state.openPorts()) },
      {
        id: 'refresh',
        group: 'Actions',
        title: 'Refresh status and previews',
        icon: 'refresh',
        run: done(() => void state.resync())
      },
      {
        id: 'stop-all',
        group: 'Actions',
        title: 'Stop every running project',
        icon: 'stop',
        keywords: 'all quit kill',
        run: done(() => {
          for (const project of projects) {
            const runtime = runtimeOf({ runtimes }, project.id)
            if (isLive(runtime.status) && !runtime.external) void state.stop(project.id)
          }
        })
      },
      {
        id: 'theme',
        group: 'Actions',
        title: `Switch to ${nextTheme} theme`,
        icon: 'preview',
        keywords: 'appearance dark light mode',
        run: done(() => void state.setTheme(nextTheme))
      },
      { id: 'logs', group: 'Actions', title: 'Toggle logs', icon: 'terminal', run: done(() => state.toggleLogPane()) },
      {
        id: 'settings',
        group: 'Actions',
        title: 'Open settings',
        icon: 'settings',
        keywords: 'preferences',
        run: done(() => state.openSettings())
      }
    )
    return out
  }, [projects, runtimes, settings, onClose])

  const results = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      // With no query: every project, then the global actions — not the
      // per-project ones, which would bury everything else.
      return commands.filter((command) => command.group === 'Projects' || !command.id.includes(':'))
    }
    return commands
      .map((command) => ({
        command,
        score: Math.max(fuzzyScore(command.title, trimmed), fuzzyScore(command.keywords ?? '', trimmed) - 50)
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((entry) => entry.command)
  }, [commands, query])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const grouped: Array<{ group: Command['group']; items: Array<{ command: Command; index: number }> }> = []
  results.forEach((command, index) => {
    const last = grouped[grouped.length - 1]
    if (last && last.group === command.group) last.items.push({ command, index })
    else grouped.push({ group: command.group, items: [{ command, index }] })
  })

  return (
    <Modal label="Command palette" width={600} align="top" onClose={onClose}>
      <div data-palette className="flex flex-col">
        <div className="flex items-center gap-[10px] border-b border-hairline px-[16px]">
          <Icon name="search" size={16} className="text-ink-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a project or run an action…"
            spellCheck={false}
            aria-label="Search projects and actions"
            className="h-[52px] min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-placeholder"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => Math.min(index + 1, results.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                results[active]?.run()
              }
            }}
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={list} role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto p-[6px]">
          {results.length === 0 && <p className="px-[12px] py-[20px] text-center text-ui text-ink-muted">No matches.</p>}
          {grouped.map(({ group, items }) => (
            <div key={`${group}-${items[0]?.index}`} className="flex flex-col">
              <span className="eyebrow px-[12px] pb-[4px] pt-[10px]">{group}</span>
              {items.map(({ command, index }) => (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={command.run}
                  className={`flex h-[36px] items-center gap-[10px] rounded-[10px] px-[12px] text-left ${
                    index === active ? 'bg-active' : ''
                  }`}
                >
                  <span className="flex w-[16px] justify-center text-ink-muted">
                    {command.status ? <StatusDot status={command.status} /> : command.icon ? <Icon name={command.icon} size={14} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ui text-ink">{command.title}</span>
                  {command.hint && (
                    <span className="max-w-[40%] shrink-0 truncate font-mono text-micro text-ink-muted">{command.hint}</span>
                  )}
                  {index === active && <Kbd>↵</Kbd>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
