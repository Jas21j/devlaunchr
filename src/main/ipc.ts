import { basename } from 'node:path'
import { app, dialog, ipcMain, shell, nativeTheme, BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { CH } from '@shared/ipc'
import type {
  ContextMenuAction,
  ContextMenuRequest,
  FolderPick,
  NewProjectInput,
  ProjectPatch,
  ScanResult
} from '@shared/ipc'
import type { AppInfo, Project, RuntimeState, Settings, ThemePreference } from '@shared/types'
import type { ListeningPort, Requirement } from '@shared/ipc'
import { detectProject, pinnedPort } from './detect'
import { scan } from './scanner'
import { listListeners } from './ports'
import { inspectRequirements } from './requirements'
import * as runtime from './processManager'
import * as store from './store'
import * as thumbnails from './thumbnails'

/**
 * `needsInstall` is a fact about the filesystem, not about a process, so it is
 * recomputed whenever state is reported rather than only after a failed start.
 * That way a project cloned but never run already shows the Install button.
 */
function withDependencyCheck(state: RuntimeState): RuntimeState {
  if (state.status !== 'stopped' && state.status !== 'crashed') return state
  const project = store.getProjects().find((p) => p.id === state.projectId)
  if (!project) return state
  return { ...state, needsInstall: runtime.dependenciesMissing(project) }
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

const themeSnapshot = (): { preference: ThemePreference; resolved: 'light' | 'dark' } => ({
  preference: nativeTheme.themeSource as ThemePreference,
  resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

export function registerIpc(): void {
  store.emitter.on('projects', (projects: Project[]) => broadcast(CH.projectsChanged, projects))
  store.emitter.on('settings', (settings: Settings) => broadcast(CH.settingsChanged, settings))

  nativeTheme.on('updated', () => broadcast(CH.appThemeChanged, themeSnapshot()))

  thumbnails.events.on('thumbnail', (info: unknown) => broadcast(CH.thumbsChanged, info))

  runtime.events.on('state', (state: RuntimeState) => {
    broadcast(CH.runtimeChanged, withDependencyCheck(state))

    // A project that just came up is worth a fresh screenshot. The capture is
    // queued and throttled inside the thumbnailer, so a burst of starts costs
    // one hidden window and one capture at a time.
    if (state.status === 'running' && state.url) {
      void thumbnails.capture(state.projectId, state.url)
    }
  })
  runtime.events.on('logs', (batch: unknown) => broadcast(CH.logsAppended, batch))

  // ------------------------------------------------------------------- app

  ipcMain.handle(CH.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    configPath: store.configPath(),
    home: app.getPath('home')
  }))

  ipcMain.handle(CH.appGetTheme, themeSnapshot)

  ipcMain.handle(CH.appSetTheme, (_event, theme: ThemePreference) => {
    if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return
    nativeTheme.themeSource = theme
    store.setSettings({ theme })
  })

  // -------------------------------------------------------------- projects

  ipcMain.handle(CH.projectsList, (): Project[] => store.getProjects())

  ipcMain.handle(CH.projectsAdd, (_event, input: NewProjectInput): Project => {
    const project = store.addProject(input)
    thumbnails.seedFromDisk(project.id, project.path)
    return project
  })

  ipcMain.handle(CH.projectsUpdate, (_event, id: string, patch: ProjectPatch): Project | null =>
    store.updateProject(id, patch)
  )

  ipcMain.handle(CH.projectsRemove, (_event, id: string): boolean => {
    thumbnails.forget(id)
    return store.removeProject(id)
  })

  ipcMain.handle(CH.projectsInspect, (_event, path: string) => detectProject(path))

  // One scan at a time. A second request cancels the first rather than racing
  // it, so the progress stream always describes a single walk.
  let activeScan: { cancelled: boolean } | null = null

  ipcMain.handle(CH.projectsScan, async (): Promise<ScanResult> => {
    if (activeScan) activeScan.cancelled = true
    const signal = { cancelled: false }
    activeScan = signal

    const settings = store.getSettings()
    const roots = settings.watchRoots
    const startedAt = Date.now()

    const outcome = await scan({
      roots,
      maxDepth: settings.scanMaxDepth,
      signal,
      isKnownPath: (path) => store.findByPath(path) !== undefined,
      onProgress: (progress) => broadcast(CH.projectsScanProgress, progress)
    })

    if (activeScan === signal) activeScan = null

    return {
      candidates: outcome.candidates,
      denied: outcome.denied,
      roots,
      durationMs: Date.now() - startedAt,
      cancelled: signal.cancelled
    }
  })

  ipcMain.handle(CH.projectsScanCancel, () => {
    if (activeScan) activeScan.cancelled = true
  })

  ipcMain.handle(CH.projectsAddMany, (_event, inputs: NewProjectInput[]): Project[] => {
    const added = store.addProjectsIfNew(
      inputs.map((input) => ({
        ...input,
        // A project that pins its own port should reserve that port, not be
        // handed one it will ignore.
        preferredPort: input.preferredPort ?? pinnedPort(input.startCommand)
      }))
    )
    // Give every newly added project whatever preview its own folder offers,
    // so the grid is not blank until each one is started for the first time.
    for (const project of added) thumbnails.seedFromDisk(project.id, project.path)
    return added
  })

  ipcMain.handle(CH.projectsPickFolder, async (event): Promise<FolderPick | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await (window
      ? dialog.showOpenDialog(window, {
          title: 'Add project',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Add'
        })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }))

    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null

    return {
      path: picked,
      name: basename(picked),
      alreadyAdded: store.findByPath(picked) !== undefined,
      detection: detectProject(picked)
    }
  })

  // --------------------------------------------------------------- runtime

  const requireProject = (id: string): Project => {
    const project = store.getProjects().find((p) => p.id === id)
    if (!project) throw new Error('That project is no longer in your list.')
    return project
  }

  ipcMain.handle(CH.runtimeStart, async (_event, id: string) => {
    const project = requireProject(id)
    await runtime.start(project, store.getSettings())
    store.updateProject(id, { lastOpenedAt: new Date().toISOString() })
  })

  ipcMain.handle(CH.runtimeStop, async (_event, id: string) => {
    await runtime.stop(requireProject(id))
  })

  ipcMain.handle(CH.runtimeRestart, async (_event, id: string) => {
    await runtime.restart(requireProject(id), store.getSettings())
  })

  ipcMain.handle(CH.runtimeDetectExternal, async (): Promise<number> =>
    runtime.detectExternal(store.getProjects())
  )

  /**
   * Re-reads the world and rebuilds what devLaunchr shows about it: which
   * projects are actually serving, and what each one currently looks like.
   *
   * Exists because a preview can go stale in ways the app cannot notice on its
   * own — a server restarted on a different port, or two projects reused one
   * port and a screenshot was taken of the wrong site.
   */
  /**
   * What each project still needs installed on this machine before it can run.
   * Only missing items are returned, so an empty map means everything is ready.
   */
  ipcMain.handle(CH.runtimeRequirements, (): Record<string, Requirement[]> => {
    const path = runtime.cachedEnvPath()
    const report: Record<string, Requirement[]> = {}
    for (const project of store.getProjects()) {
      const missing = inspectRequirements(project, path).filter((entry) => !entry.present)
      if (missing.length > 0) report[project.id] = missing
    }
    return report
  })

  ipcMain.handle(
    CH.runtimeResync,
    async (): Promise<{ adopted: number; recaptured: number; discarded: number }> => {
      const projects = store.getProjects()
      const adopted = await runtime.detectExternal(projects)

      // What each project should currently be showing, so an image taken from
      // somewhere else can be identified.
      const expected = new Map<string, string | null>()
      for (const project of projects) {
        expected.set(project.id, runtime.getState(project.id).url)
      }
      const discarded = thumbnails.discardUnverified(expected)

      const live = runtime.runningWithUrls()
      const results = await Promise.all(
        live.map((entry) => thumbnails.capture(entry.projectId, entry.url, { force: true }))
      )

      // A project with no screenshot may still ship a preview image of its own.
      for (const projectId of discarded) {
        const project = projects.find((entry) => entry.id === projectId)
        if (project) thumbnails.seedFromDisk(project.id, project.path)
      }

      return { adopted, recaptured: results.filter(Boolean).length, discarded: discarded.length }
    }
  )

  ipcMain.handle(CH.runtimeStates, (): RuntimeState[] => {
    const known = new Map(runtime.allStates().map((state) => [state.projectId, state]))
    // Include projects that have never been touched this session, so the grid
    // can flag missing dependencies before anything is started.
    return store.getProjects().map((project) => {
      const state = known.get(project.id) ?? runtime.getState(project.id)
      return withDependencyCheck(state)
    })
  })

  ipcMain.handle(CH.runtimeInstall, async (_event, id: string) => {
    return runtime.install(requireProject(id))
  })

  ipcMain.handle(CH.runtimeRunFix, async (_event, id: string, command: string) => {
    // The command comes from devLaunchr's own diagnosis table, never from the
    // project or from anything read off disk.
    if (typeof command !== 'string' || !command.trim()) return false
    return runtime.runFix(requireProject(id), command)
  })

  ipcMain.handle(CH.logsGet, (_event, id: string) => runtime.getLogs(id))
  ipcMain.handle(CH.logsClear, (_event, id: string) => runtime.clearLogs(id))

  // --------------------------------------------------------------- ports

  ipcMain.handle(CH.systemListeners, async (): Promise<ListeningPort[]> => {
    const listeners = await listListeners()
    const projects = store.getProjects()

    const ours = new Map<number, Project>()
    for (const project of projects) {
      const state = runtime.getState(project.id)
      if (state.port !== null && state.status === 'running') ours.set(state.port, project)
    }

    return listeners.map((listener) => {
      const project = ours.get(listener.port)
      return {
        ...listener,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null
      }
    })
  })

  /**
   * Kills a process that is not ours, to free a port. Destructive and
   * irreversible, so it always goes through a native confirmation naming the
   * process — never a silent kill.
   */
  ipcMain.handle(CH.systemFreePort, async (event, pid: number, port: number, command: string) => {
    if (!Number.isInteger(pid) || pid <= 1) return false

    const window = BrowserWindow.fromWebContents(event.sender)
    const { response } = await dialog.showMessageBox(window ?? new BrowserWindow({ show: false }), {
      type: 'warning',
      buttons: ['Cancel', 'Quit process'],
      defaultId: 0,
      cancelId: 0,
      title: 'Free this port?',
      message: `Quit “${command}” (pid ${pid}) to free port ${port}?`,
      detail:
        'devLaunchr did not start this process. Quitting it may lose unsaved work in whatever app owns it.'
    })
    if (response !== 1) return false

    try {
      process.kill(pid, 'SIGTERM')
      return true
    } catch {
      return false
    }
  })

  // ------------------------------------------------------------ thumbnails

  ipcMain.handle(CH.thumbsList, () =>
    thumbnails.all(store.getProjects().map((project) => project.id))
  )

  ipcMain.handle(CH.thumbsRefresh, async (_event, id: string) => {
    const state = runtime.getState(id)
    if (state.status !== 'running' || !state.url) return false
    return thumbnails.capture(id, state.url, { force: true })
  })

  // -------------------------------------------------------------- settings

  ipcMain.handle(CH.settingsGet, (): Settings => store.getSettings())
  ipcMain.handle(CH.settingsSet, (_event, patch: Partial<Settings>): Settings =>
    store.setSettings(patch)
  )

  // ---------------------------------------------------------------- system

  ipcMain.handle(CH.systemOpenExternal, async (_event, url: string) => {
    // A compromised renderer must not be able to hand the OS a file:// or
    // custom-scheme URL through this channel.
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    await shell.openExternal(parsed.toString())
    return true
  })

  ipcMain.handle(CH.systemRevealInFinder, (_event, path: string) => {
    shell.showItemInFolder(path)
  })

  /**
   * Native context menu rather than a DOM one: it renders above the embedded
   * webviews added in step 5, which a DOM menu could not, and it matches the
   * platform's own menu behavior for free.
   */
  ipcMain.handle(
    CH.systemContextMenu,
    async (event, request: ContextMenuRequest): Promise<ContextMenuAction | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return null

      const state = runtime.getState(request.projectId)
      const canStart = state.status === 'stopped' || state.status === 'crashed'
      const canStop = state.status === 'running' || state.status === 'starting'
      const hasUrl = state.url !== null

      return new Promise<ContextMenuAction | null>((resolve) => {
        let chosen: ContextMenuAction | null = null
        const pick = (action: ContextMenuAction) => () => {
          chosen = action
        }

        const template: MenuItemConstructorOptions[] = [
          { label: 'Start', enabled: canStart, click: pick('start') },
          { label: 'Stop', enabled: canStop, click: pick('stop') },
          { label: 'Restart', enabled: canStop, click: pick('restart') },
          { type: 'separator' },
          { label: 'Open in Browser', enabled: hasUrl, click: pick('openExternal') },
          { label: 'Copy URL', enabled: hasUrl, click: pick('copyUrl') },
          { label: 'Open in Finder', click: pick('revealInFinder') },
          { label: 'Open in Editor', click: pick('openInEditor') },
          { type: 'separator' },
          {
            label: request.favorite ? 'Remove from Favorites' : 'Add to Favorites',
            click: pick('toggleFavorite')
          },
          { label: 'Edit…', click: pick('edit') },
          { type: 'separator' },
          { label: 'Remove from devLaunchr', click: pick('remove') }
        ]

        Menu.buildFromTemplate(template).popup({
          window,
          callback: () => resolve(chosen)
        })
      })
    }
  )
}
