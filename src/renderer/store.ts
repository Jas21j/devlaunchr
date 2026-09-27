import { create } from 'zustand'
import type { LogLine, Project, ProjectType, RuntimeState, Settings } from '@shared/types'
import type {
  Detection, NewProjectInput, Requirement, ScanCandidate, ScanProgress, ScanResult, ThumbnailInfo
} from '@shared/ipc'

export interface Draft {
  id: string | null
  name: string
  path: string
  type: ProjectType
  startCommand: string
  installCommand: string
  preferredPort: string
  env: Array<{ key: string; value: string }>
  autoOpen: boolean
  favorite: boolean
  notes: string
  detection: Detection | null
}

export interface ScanState {
  status: 'scanning' | 'review'
  progress: ScanProgress
  result: ScanResult | null
  selected: Set<string>
  filter: string
}

/**
 * Stopped placeholders are cached per project id.
 *
 * zustand selectors run through useSyncExternalStore, which compares the
 * previous and next results by reference. Building a fresh object inside a
 * selector returns a new reference on every render, so React re-renders
 * forever and the window goes blank. The cache keeps the identity stable.
 */
const stoppedCache = new Map<string, RuntimeState>()

const stopped = (projectId: string): RuntimeState => {
  let state = stoppedCache.get(projectId)
  if (!state) {
    state = {
      projectId,
      status: 'stopped',
      pid: null,
      port: null,
      url: null,
      startedAt: null,
      lastError: null,
      needsInstall: false,
      conflict: null,
      diagnosis: null,
      external: null
    }
    stoppedCache.set(projectId, state)
  }
  return state
}

interface AppState {
  projects: Project[]
  settings: Settings | null
  runtimes: Record<string, RuntimeState>
  thumbs: Record<string, ThumbnailInfo>
  /** Missing system tools, per project. Absent means nothing is missing. */
  requirements: Record<string, Requirement[]>
  logs: Record<string, LogLine[]>
  logFilter: string
  logPaneOpen: boolean
  /** Project ids that have an open preview tab, in tab order. */
  tabs: string[]
  portsOpen: boolean
  query: string
  selectedId: string | null
  draft: Draft | null
  error: string | null
  scan: ScanState | null

  load: () => Promise<void>
  setQuery: (query: string) => void
  select: (id: string | null) => void
  dismissError: () => void

  beginAdd: () => Promise<void>
  beginEdit: (id: string) => void
  updateDraft: (patch: Partial<Draft>) => void
  cancelDraft: () => void
  commitDraft: () => Promise<void>

  toggleFavorite: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>

  start: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  restart: (id: string) => Promise<void>
  clearLogs: (id: string) => Promise<void>
  loadLogs: (id: string) => Promise<void>
  setLogFilter: (filter: string) => void
  toggleLogPane: () => void

  openPorts: () => void
  closePorts: () => void
  install: (id: string) => Promise<void>
  runFix: (id: string, command: string) => Promise<void>
  resyncing: boolean
  resync: () => Promise<void>
  openTab: (id: string, focus?: boolean) => void
  closeTab: (id: string) => void
  refreshThumb: (id: string) => Promise<void>

  startScan: () => Promise<void>
  cancelScan: () => Promise<void>
  closeScan: () => void
  setScanFilter: (filter: string) => void
  toggleCandidate: (path: string) => void
  setAllCandidates: (selected: boolean, paths: string[]) => void
  commitScan: () => Promise<void>
}

const emptyDraft = (path: string, name: string, detection: Detection | null): Draft => ({
  id: null,
  name,
  path,
  type: detection?.type ?? 'custom',
  startCommand: detection?.startCommand ?? '',
  installCommand: detection?.installCommand ?? '',
  preferredPort: '',
  env: [],
  autoOpen: false,
  favorite: false,
  notes: '',
  detection
})

const draftFrom = (project: Project): Draft => ({
  id: project.id,
  name: project.name,
  path: project.path,
  type: project.type,
  startCommand: project.startCommand,
  installCommand: project.installCommand ?? '',
  preferredPort: project.preferredPort === null ? '' : String(project.preferredPort),
  env: Object.entries(project.env).map(([key, value]) => ({ key, value })),
  autoOpen: project.autoOpen,
  favorite: project.favorite,
  notes: project.notes ?? '',
  detection: null
})

function draftToInput(draft: Draft): NewProjectInput {
  const env: Record<string, string> = {}
  for (const { key, value } of draft.env) {
    const trimmed = key.trim()
    if (trimmed) env[trimmed] = value
  }

  const parsedPort = Number.parseInt(draft.preferredPort, 10)

  return {
    name: draft.name,
    path: draft.path,
    type: draft.type,
    startCommand: draft.startCommand.trim(),
    ...(draft.installCommand.trim() ? { installCommand: draft.installCommand.trim() } : {}),
    preferredPort: Number.isInteger(parsedPort) ? parsedPort : null,
    env,
    autoOpen: draft.autoOpen,
    favorite: draft.favorite,
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {})
  }
}

const message = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  // Electron prefixes every rejected invoke with the handler frame; the user
  // only cares about the sentence we threw.
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

export const useApp = create<AppState>((set, get) => ({
  projects: [],
  settings: null,
  runtimes: {},
  thumbs: {},
  requirements: {},
  logs: {},
  logFilter: '',
  logPaneOpen: true,
  tabs: [],
  portsOpen: false,
  resyncing: false,
  query: '',
  selectedId: null,
  draft: null,
  error: null,
  scan: null,

  load: async () => {
    const [projects, settings, states, thumbList, requirements] = await Promise.all([
      window.devlaunchr.projects.list(),
      window.devlaunchr.settings.get(),
      window.devlaunchr.runtime.states(),
      window.devlaunchr.thumbs.list(),
      window.devlaunchr.runtime.requirements()
    ])
    const runtimes: Record<string, RuntimeState> = {}
    for (const state of states) runtimes[state.projectId] = state
    const thumbs: Record<string, ThumbnailInfo> = {}
    for (const info of thumbList) thumbs[info.projectId] = info
    set({ projects, settings, runtimes, thumbs, requirements })

    // Adopt anything already serving from a terminal before the user can click
    // Start on it and get a port collision.
    void window.devlaunchr.runtime.detectExternal()
  },

  start: async (id) => {
    try {
      await window.devlaunchr.runtime.start(id)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  stop: async (id) => {
    try {
      await window.devlaunchr.runtime.stop(id)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  restart: async (id) => {
    try {
      await window.devlaunchr.runtime.restart(id)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  clearLogs: async (id) => {
    await window.devlaunchr.runtime.clearLogs(id)
    set({ logs: { ...get().logs, [id]: [] } })
  },

  loadLogs: async (id) => {
    if (get().logs[id]) return
    const lines = await window.devlaunchr.runtime.logs(id)
    set({ logs: { ...get().logs, [id]: lines } })
  },

  setLogFilter: (logFilter) => set({ logFilter }),
  toggleLogPane: () => set({ logPaneOpen: !get().logPaneOpen }),

  openPorts: () => set({ portsOpen: true }),
  closePorts: () => set({ portsOpen: false }),

  install: async (id) => {
    try {
      await window.devlaunchr.runtime.install(id)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  /**
   * Re-reads which projects are actually serving and re-photographs every one
   * of them. The manual escape hatch for a preview that has gone stale.
   */
  resync: async () => {
    if (get().resyncing) return
    set({ resyncing: true })
    try {
      const { adopted, recaptured, discarded } = await window.devlaunchr.runtime.resync()
      await get().load()

      const parts: string[] = []
      if (recaptured > 0) parts.push(`${recaptured} preview${recaptured === 1 ? '' : 's'} retaken`)
      if (discarded > 0) parts.push(`${discarded} unverified image${discarded === 1 ? '' : 's'} cleared`)
      if (adopted > 0) parts.push(`${adopted} running outside devLaunchr`)

      set({ error: parts.length > 0 ? `Refreshed: ${parts.join(' · ')}.` : 'Everything is already up to date.' })
    } catch (error) {
      set({ error: message(error) })
    } finally {
      set({ resyncing: false })
    }
  },

  runFix: async (id, command) => {
    try {
      await window.devlaunchr.runtime.runFix(id, command)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  refreshThumb: async (id) => {
    await window.devlaunchr.thumbs.refresh(id)
  },

  openTab: (id, focus = true) => {
    const tabs = get().tabs
    if (!tabs.includes(id)) set({ tabs: [...tabs, id] })
    if (focus) set({ selectedId: id })
  },

  /**
   * Closing a preview never stops the server. Stopping is always explicit —
   * otherwise tidying up your tabs would silently kill your work.
   */
  closeTab: (id) => {
    const tabs = get().tabs.filter((tab) => tab !== id)
    set({ tabs })
    if (get().selectedId === id) set({ selectedId: tabs[tabs.length - 1] ?? null })
  },

  setQuery: (query) => set({ query }),
  select: (selectedId) => set({ selectedId }),
  dismissError: () => set({ error: null }),

  beginAdd: async () => {
    const pick = await window.devlaunchr.projects.pickFolder()
    if (!pick) return
    if (pick.alreadyAdded) {
      set({ error: `${pick.name} is already in your list.` })
      return
    }
    set({ draft: emptyDraft(pick.path, pick.name, pick.detection) })
  },

  beginEdit: (id) => {
    const project = get().projects.find((p) => p.id === id)
    if (project) set({ draft: draftFrom(project) })
  },

  updateDraft: (patch) => {
    const draft = get().draft
    if (draft) set({ draft: { ...draft, ...patch } })
  },

  cancelDraft: () => set({ draft: null }),

  commitDraft: async () => {
    const draft = get().draft
    if (!draft) return
    const input = draftToInput(draft)

    try {
      if (draft.id) {
        await window.devlaunchr.projects.update(draft.id, input)
      } else {
        const created = await window.devlaunchr.projects.add(input)
        set({ selectedId: created.id })
      }
      set({ draft: null })
    } catch (error) {
      set({ error: message(error) })
    }
  },

  toggleFavorite: async (id) => {
    const project = get().projects.find((p) => p.id === id)
    if (!project) return
    await window.devlaunchr.projects.update(id, { favorite: !project.favorite })
  },

  remove: async (id) => {
    await window.devlaunchr.projects.remove(id)
    if (get().selectedId === id) set({ selectedId: null })
  },

  startScan: async () => {
    set({
      scan: {
        status: 'scanning',
        progress: { scanned: 0, found: 0, current: '' },
        result: null,
        selected: new Set(),
        filter: ''
      }
    })

    try {
      const result = await window.devlaunchr.projects.scan()
      // Pre-select everything not already in the list — the common case is
      // "add all of these", and unchecking a few is less work than checking
      // twenty.
      const selected = new Set(
        result.candidates.filter((c) => !c.alreadyAdded).map((c) => c.path)
      )
      set({
        scan: {
          status: 'review',
          progress: { scanned: 0, found: result.candidates.length, current: '' },
          result,
          selected,
          filter: ''
        }
      })
    } catch (error) {
      set({ scan: null, error: message(error) })
    }
  },

  cancelScan: async () => {
    await window.devlaunchr.projects.cancelScan()
    set({ scan: null })
    void window.devlaunchr.settings.set({ hasCompletedFirstScan: true })
  },

  closeScan: () => {
    set({ scan: null })
    void window.devlaunchr.settings.set({ hasCompletedFirstScan: true })
  },

  setScanFilter: (filter) => {
    const scan = get().scan
    if (scan) set({ scan: { ...scan, filter } })
  },

  toggleCandidate: (path) => {
    const scan = get().scan
    if (!scan) return
    const selected = new Set(scan.selected)
    if (selected.has(path)) selected.delete(path)
    else selected.add(path)
    set({ scan: { ...scan, selected } })
  },

  setAllCandidates: (shouldSelect, paths) => {
    const scan = get().scan
    if (!scan) return
    const selected = new Set(scan.selected)
    for (const path of paths) {
      if (shouldSelect) selected.add(path)
      else selected.delete(path)
    }
    set({ scan: { ...scan, selected } })
  },

  commitScan: async () => {
    const scan = get().scan
    if (!scan?.result) return

    const inputs: NewProjectInput[] = scan.result.candidates
      .filter((c) => scan.selected.has(c.path) && !c.alreadyAdded)
      .map((c) => ({
        name: c.name,
        path: c.path,
        type: c.detection.type,
        startCommand: c.detection.startCommand,
        ...(c.detection.installCommand ? { installCommand: c.detection.installCommand } : {}),
        preferredPort: null,
        env: {},
        autoOpen: false,
        favorite: false
      }))

    try {
      await window.devlaunchr.projects.addMany(inputs)
      set({ scan: null })
      void window.devlaunchr.settings.set({ hasCompletedFirstScan: true })
    } catch (error) {
      set({ error: message(error) })
    }
  }
}))

/**
 * Main pushes the full list on every mutation, so the renderer never refetches
 * and never polls — the store is a mirror, not a cache.
 */
/** Reads the live state for a project, defaulting to a stable stopped value. */
export const runtimeOf = (state: AppState, id: string | null): RuntimeState =>
  (id ? state.runtimes[id] : undefined) ?? stopped(id ?? '')

export function bindMainProcessEvents(): () => void {
  const offProjects = window.devlaunchr.projects.onChanged((projects) =>
    useApp.setState({ projects })
  )
  const offSettings = window.devlaunchr.settings.onChanged((settings) =>
    useApp.setState({ settings })
  )
  const offRuntime = window.devlaunchr.runtime.onChanged((state) => {
    useApp.setState((current) => {
      const next: Partial<AppState> = {
        runtimes: { ...current.runtimes, [state.projectId]: state }
      }

      // A project that comes up gets its own preview tab. Whether it also
      // steals focus is the project's `autoOpen` setting.
      if (state.status === 'running' && !current.tabs.includes(state.projectId)) {
        next.tabs = [...current.tabs, state.projectId]
        const project = current.projects.find((p) => p.id === state.projectId)
        if (project?.autoOpen) next.selectedId = state.projectId
      }

      return next
    })
  })

  const offLogs = window.devlaunchr.runtime.onLogs((batch) => {
    useApp.setState((current) => {
      const existing = current.logs[batch.projectId] ?? []
      const merged = [...existing, ...batch.lines]
      // Mirror the main process's ring buffer so the renderer cannot grow
      // without bound during a long-running build.
      return {
        logs: {
          ...current.logs,
          [batch.projectId]: merged.length > 2000 ? merged.slice(-2000) : merged
        }
      }
    })
  })

  const offThumbs = window.devlaunchr.thumbs.onChanged((info) => {
    useApp.setState((current) => ({ thumbs: { ...current.thumbs, [info.projectId]: info } }))
  })

  const offReaped = window.devlaunchr.runtime.onReaped((notice) => {
    if (notice.reaped.length === 0) return
    const names = notice.reaped.map((entry) => entry.name).join(', ')
    useApp.setState({
      error: `Cleaned up ${notice.reaped.length} server${
        notice.reaped.length === 1 ? '' : 's'
      } left running by a previous session: ${names}.`
    })
  })

  const offScan = window.devlaunchr.projects.onScanProgress((progress) => {
    const scan = useApp.getState().scan
    if (scan?.status === 'scanning') useApp.setState({ scan: { ...scan, progress } })
  })
  return () => {
    offProjects()
    offSettings()
    offRuntime()
    offLogs()
    offThumbs()
    offReaped()
    offScan()
  }
}

export type { ScanCandidate }
