import { create } from 'zustand'
import type {
  AppInfo, LogLine, Project, ProjectType, RuntimeState, Settings, ThemePreference
} from '@shared/types'
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

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  resolve: (confirmed: boolean) => void
}

export type HomeFilter = 'all' | 'running' | 'stopped' | 'attention'
export type SortOrder = 'name' | 'recent' | 'status'
export type SettingsSection = 'appearance' | 'projects' | 'servers' | 'editor' | 'system' | 'about'

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

/**
 * Per-viewer interface preferences (sort order, log height). Storage can be
 * unavailable or throw, and the app must work identically without it.
 */
const prefs = {
  get<T extends string | number>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`devlaunchr:${key}`)
      if (raw === null) return fallback
      return (typeof fallback === 'number' ? Number(raw) : raw) as T
    } catch {
      return fallback
    }
  },
  set(key: string, value: string | number): void {
    try {
      localStorage.setItem(`devlaunchr:${key}`, String(value))
    } catch {
      // Preference only; losing it is harmless.
    }
  }
}

const SORTS: SortOrder[] = ['name', 'recent', 'status']
export const LOG_HEIGHT = { min: 120, max: 560, initial: 220 }

interface AppState {
  info: AppInfo | null
  projects: Project[]
  settings: Settings | null
  runtimes: Record<string, RuntimeState>
  thumbs: Record<string, ThumbnailInfo>
  /** Missing system tools, per project. Absent means nothing is missing. */
  requirements: Record<string, Requirement[]>
  logs: Record<string, LogLine[]>
  logFilter: string
  logPaneOpen: boolean
  logHeight: number
  /** Project ids that have an open preview tab, in tab order. */
  tabs: string[]
  portsOpen: boolean
  paletteOpen: boolean
  settingsOpen: boolean
  settingsSection: SettingsSection
  query: string
  homeFilter: HomeFilter
  sort: SortOrder
  selectedId: string | null
  draft: Draft | null
  toasts: Toast[]
  confirm: ConfirmRequest | null
  scan: ScanState | null
  resyncing: boolean

  load: () => Promise<void>
  setQuery: (query: string) => void
  setHomeFilter: (filter: HomeFilter) => void
  setSort: (sort: SortOrder) => void
  select: (id: string | null) => void

  notify: (message: string, tone?: ToastTone) => void
  dismissToast: (id: number) => void
  askConfirm: (request: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>
  settleConfirm: (confirmed: boolean) => void

  beginAdd: () => Promise<void>
  beginEdit: (id: string) => void
  updateDraft: (patch: Partial<Draft>) => void
  cancelDraft: () => void
  commitDraft: () => Promise<void>

  toggleFavorite: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  openInEditor: (id: string) => Promise<void>

  start: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  restart: (id: string) => Promise<void>
  clearLogs: (id: string) => Promise<void>
  loadLogs: (id: string) => Promise<void>
  setLogFilter: (filter: string) => void
  toggleLogPane: () => void
  setLogHeight: (height: number) => void

  openPorts: () => void
  closePorts: () => void
  openPalette: () => void
  closePalette: () => void
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  setTheme: (theme: ThemePreference) => Promise<void>

  install: (id: string) => Promise<void>
  runFix: (id: string, command: string) => Promise<void>
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

let nextToastId = 1

export const useApp = create<AppState>((set, get) => {
  /** Runs an IPC call and turns a rejection into an error toast. */
  const attempt = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work()
    } catch (error) {
      get().notify(message(error), 'error')
    }
  }

  return {
    info: null,
    projects: [],
    settings: null,
    runtimes: {},
    thumbs: {},
    requirements: {},
    logs: {},
    logFilter: '',
    logPaneOpen: prefs.get('logPaneOpen', 'true') === 'true',
    logHeight: Math.min(Math.max(prefs.get('logHeight', LOG_HEIGHT.initial), LOG_HEIGHT.min), LOG_HEIGHT.max),
    tabs: [],
    portsOpen: false,
    paletteOpen: false,
    settingsOpen: false,
    settingsSection: 'appearance',
    resyncing: false,
    query: '',
    homeFilter: 'all',
    sort: (() => {
      const stored = prefs.get<string>('sort', 'name')
      return SORTS.includes(stored as SortOrder) ? (stored as SortOrder) : 'name'
    })(),
    selectedId: null,
    draft: null,
    toasts: [],
    confirm: null,
    scan: null,

    load: async () => {
      const [info, projects, settings, states, thumbList, requirements] = await Promise.all([
        window.devlaunchr.app.info(),
        window.devlaunchr.projects.list(),
        window.devlaunchr.settings.get(),
        window.devlaunchr.runtime.states(),
        window.devlaunchr.thumbs.list(),
        window.devlaunchr.runtime.requirements()
      ])
      const runtimes: Record<string, RuntimeState> = {}
      for (const state of states) runtimes[state.projectId] = state
      const thumbs: Record<string, ThumbnailInfo> = {}
      for (const entry of thumbList) thumbs[entry.projectId] = entry
      set({ info, projects, settings, runtimes, thumbs, requirements })

      // Adopt anything already serving from a terminal before the user can
      // click Start on it and get a port collision.
      void window.devlaunchr.runtime.detectExternal()
    },

    setQuery: (query) => set({ query }),
    setHomeFilter: (homeFilter) => set({ homeFilter, selectedId: null }),
    setSort: (sort) => {
      prefs.set('sort', sort)
      set({ sort })
    },
    select: (selectedId) => set({ selectedId }),

    notify: (text, tone = 'info') => {
      const toast = { id: nextToastId++, message: text, tone }
      // Three at most; the oldest makes room.
      set({ toasts: [...get().toasts, toast].slice(-3) })
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),

    askConfirm: (request) =>
      new Promise<boolean>((resolve) => {
        // A second request answers the first with "no" rather than orphaning it.
        get().confirm?.resolve(false)
        set({ confirm: { ...request, resolve } })
      }),
    settleConfirm: (confirmed) => {
      const pending = get().confirm
      set({ confirm: null })
      pending?.resolve(confirmed)
    },

    start: (id) => attempt(() => window.devlaunchr.runtime.start(id)),
    stop: (id) => attempt(() => window.devlaunchr.runtime.stop(id)),
    restart: (id) => attempt(() => window.devlaunchr.runtime.restart(id)),
    install: (id) => attempt(() => window.devlaunchr.runtime.install(id)),
    runFix: (id, command) => attempt(() => window.devlaunchr.runtime.runFix(id, command)),

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
    toggleLogPane: () => {
      const logPaneOpen = !get().logPaneOpen
      prefs.set('logPaneOpen', String(logPaneOpen))
      set({ logPaneOpen })
    },
    setLogHeight: (height) => {
      const logHeight = Math.round(Math.min(Math.max(height, LOG_HEIGHT.min), LOG_HEIGHT.max))
      prefs.set('logHeight', logHeight)
      set({ logHeight })
    },

    openPorts: () => set({ portsOpen: true, paletteOpen: false }),
    closePorts: () => set({ portsOpen: false }),
    openPalette: () => set({ paletteOpen: true }),
    closePalette: () => set({ paletteOpen: false }),
    openSettings: (section) =>
      set({ settingsOpen: true, paletteOpen: false, ...(section ? { settingsSection: section } : {}) }),
    closeSettings: () => set({ settingsOpen: false }),

    updateSettings: (patch) =>
      attempt(async () => {
        set({ settings: await window.devlaunchr.settings.set(patch) })
      }),

    setTheme: (theme) => attempt(() => window.devlaunchr.app.setTheme(theme)),

    /**
     * Re-reads which projects are actually serving and re-photographs every
     * one of them. The manual escape hatch for a preview that has gone stale.
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

        get().notify(
          parts.length > 0 ? `Refreshed: ${parts.join(' · ')}.` : 'Everything is already up to date.',
          'success'
        )
      } catch (error) {
        get().notify(message(error), 'error')
      } finally {
        set({ resyncing: false })
      }
    },

    refreshThumb: async (id) => {
      const ok = await window.devlaunchr.thumbs.refresh(id)
      if (ok) get().notify('Preview image updated.', 'success')
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

    beginAdd: async () => {
      const pick = await window.devlaunchr.projects.pickFolder()
      if (!pick) return
      if (pick.alreadyAdded) {
        get().notify(`${pick.name} is already in your list.`)
        return
      }
      set({ draft: emptyDraft(pick.path, pick.name, pick.detection) })
    },

    beginEdit: (id) => {
      const project = get().projects.find((p) => p.id === id)
      if (project) set({ draft: draftFrom(project), paletteOpen: false })
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

      await attempt(async () => {
        if (draft.id) {
          await window.devlaunchr.projects.update(draft.id, input)
        } else {
          const created = await window.devlaunchr.projects.add(input)
          set({ selectedId: created.id })
        }
        set({ draft: null })
      })
    },

    toggleFavorite: async (id) => {
      const project = get().projects.find((p) => p.id === id)
      if (!project) return
      await attempt(() => window.devlaunchr.projects.update(id, { favorite: !project.favorite }))
    },

    remove: async (id) => {
      const project = get().projects.find((p) => p.id === id)
      if (!project) return
      const status = runtimeOf(get(), id).status
      const live = status === 'running' || status === 'starting' || status === 'installing'

      const confirmed = await get().askConfirm({
        title: `Remove ${project.name}?`,
        message: live
          ? 'Its server is running and will be stopped. The folder on disk is not touched, and a scan will find it again.'
          : 'The folder on disk is not touched, and a scan will find it again.',
        confirmLabel: live ? 'Stop and remove' : 'Remove',
        destructive: true
      })
      if (!confirmed) return

      await attempt(async () => {
        await window.devlaunchr.projects.remove(id)
        const tabs = get().tabs.filter((tab) => tab !== id)
        set({ tabs, ...(get().selectedId === id ? { selectedId: null } : {}) })
      })
    },

    openInEditor: async (id) => {
      const result = await window.devlaunchr.system.openInEditor(id)
      if (!result.ok) get().notify(result.message, 'error')
    },

    startScan: async () => {
      set({
        paletteOpen: false,
        settingsOpen: false,
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
        // A cancelled walk still resolves, with whatever it had found; the
        // user already closed it, so it must not reopen as a review screen.
        if (!get().scan || result.cancelled) return
        // Pre-select everything not already in the list — the common case is
        // "add all of these", and unchecking a few is less work than checking
        // twenty.
        const selected = new Set(result.candidates.filter((c) => !c.alreadyAdded).map((c) => c.path))
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
        set({ scan: null })
        get().notify(message(error), 'error')
      }
    },

    cancelScan: async () => {
      set({ scan: null })
      await window.devlaunchr.projects.cancelScan()
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

      await attempt(async () => {
        const added = await window.devlaunchr.projects.addMany(inputs)
        set({ scan: null })
        void window.devlaunchr.settings.set({ hasCompletedFirstScan: true })
        get().notify(`Added ${added.length} project${added.length === 1 ? '' : 's'}.`, 'success')
      })
    }
  }
})

/** Reads the live state for a project, defaulting to a stable stopped value. */
export const runtimeOf = (state: Pick<AppState, 'runtimes'>, id: string | null): RuntimeState =>
  (id ? state.runtimes[id] : undefined) ?? stopped(id ?? '')

/** Live or on its way up or down — anything the user would call "running". */
export const isLive = (status: RuntimeState['status']): boolean =>
  status === 'running' || status === 'starting'

export const isBusy = (status: RuntimeState['status']): boolean =>
  status === 'starting' || status === 'stopping' || status === 'installing'

/**
 * A project that cannot run as it stands: crashed, missing its dependencies,
 * or missing a system tool it needs.
 */
export function needsAttention(state: Pick<AppState, 'runtimes' | 'requirements'>, id: string): boolean {
  const runtime = runtimeOf(state, id)
  if (isLive(runtime.status)) return false
  return (
    runtime.status === 'crashed' || runtime.needsInstall || (state.requirements[id]?.length ?? 0) > 0
  )
}

/**
 * Main pushes the full list on every mutation, so the renderer never refetches
 * and never polls — the store is a mirror, not a cache.
 */
export function bindMainProcessEvents(onCommand: (command: import('@shared/ipc').AppCommand) => void): () => void {
  const offProjects = window.devlaunchr.projects.onChanged((projects) => useApp.setState({ projects }))
  const offSettings = window.devlaunchr.settings.onChanged((settings) => useApp.setState({ settings }))
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

  const offThumbs = window.devlaunchr.thumbs.onChanged((entry) => {
    useApp.setState((current) => ({ thumbs: { ...current.thumbs, [entry.projectId]: entry } }))
  })

  const offReaped = window.devlaunchr.runtime.onReaped((notice) => {
    if (notice.reaped.length === 0) return
    const names = notice.reaped.map((entry) => entry.name).join(', ')
    useApp
      .getState()
      .notify(
        `Cleaned up ${notice.reaped.length} server${notice.reaped.length === 1 ? '' : 's'} left running by a previous session: ${names}.`
      )
  })

  const offIdle = window.devlaunchr.runtime.onIdleStopped((notice) => {
    useApp
      .getState()
      .notify(`Stopped ${notice.name} after ${notice.minutes} minutes with no activity.`)
  })

  const offScan = window.devlaunchr.projects.onScanProgress((progress) => {
    const scan = useApp.getState().scan
    if (scan?.status === 'scanning') useApp.setState({ scan: { ...scan, progress } })
  })

  const offCommand = window.devlaunchr.app.onCommand(onCommand)

  return () => {
    offProjects()
    offSettings()
    offRuntime()
    offLogs()
    offThumbs()
    offReaped()
    offIdle()
    offScan()
    offCommand()
  }
}

export type { ScanCandidate }
