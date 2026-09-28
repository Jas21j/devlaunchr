import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '@shared/ipc'
import type {
  AppCommand,
  ContextMenuAction,
  ContextMenuRequest,
  Detection,
  EditorOpenResult,
  FolderPick,
  IdleStopNotice,
  ListeningPort,
  LogBatch,
  NewProjectInput,
  ProjectPatch,
  ReapNotice,
  Requirement,
  ScanProgress,
  ScanResult,
  ThumbnailInfo
} from '@shared/ipc'
import type {
  AppInfo,
  LogLine,
  Project,
  RuntimeState,
  Settings,
  ThemePreference
} from '@shared/types'

export interface ResolvedTheme {
  preference: ThemePreference
  resolved: 'light' | 'dark'
}

/** Wraps `ipcRenderer.on` so every subscriber gets a disposer and nothing leaks. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/**
 * The entire surface the renderer is allowed to touch.
 *
 * Every method is explicitly enumerated — there is deliberately no
 * `invoke(channel, ...args)` passthrough, because that would hand the renderer
 * the whole main-process IPC table and make the sandbox decorative.
 */
const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(CH.appInfo),
    getTheme: (): Promise<ResolvedTheme> => ipcRenderer.invoke(CH.appGetTheme),
    setTheme: (theme: ThemePreference): Promise<void> => ipcRenderer.invoke(CH.appSetTheme, theme),
    onThemeChanged: (listener: (theme: ResolvedTheme) => void): (() => void) =>
      subscribe(CH.appThemeChanged, listener),
    /** Commands chosen from the native menu or its keyboard shortcuts. */
    onCommand: (listener: (command: AppCommand) => void): (() => void) =>
      subscribe(CH.appCommand, listener)
  },

  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke(CH.projectsList),
    add: (input: NewProjectInput): Promise<Project> => ipcRenderer.invoke(CH.projectsAdd, input),
    update: (id: string, patch: ProjectPatch): Promise<Project | null> =>
      ipcRenderer.invoke(CH.projectsUpdate, id, patch),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(CH.projectsRemove, id),
    pickFolder: (): Promise<FolderPick | null> => ipcRenderer.invoke(CH.projectsPickFolder),
    inspect: (path: string): Promise<Detection> => ipcRenderer.invoke(CH.projectsInspect, path),
    scan: (): Promise<ScanResult> => ipcRenderer.invoke(CH.projectsScan),
    cancelScan: (): Promise<void> => ipcRenderer.invoke(CH.projectsScanCancel),
    addMany: (inputs: NewProjectInput[]): Promise<Project[]> =>
      ipcRenderer.invoke(CH.projectsAddMany, inputs),
    onScanProgress: (listener: (progress: ScanProgress) => void): (() => void) =>
      subscribe(CH.projectsScanProgress, listener),
    onChanged: (listener: (projects: Project[]) => void): (() => void) =>
      subscribe(CH.projectsChanged, listener)
  },

  runtime: {
    start: (id: string): Promise<void> => ipcRenderer.invoke(CH.runtimeStart, id),
    stop: (id: string): Promise<void> => ipcRenderer.invoke(CH.runtimeStop, id),
    restart: (id: string): Promise<void> => ipcRenderer.invoke(CH.runtimeRestart, id),
    states: (): Promise<RuntimeState[]> => ipcRenderer.invoke(CH.runtimeStates),
    install: (id: string): Promise<boolean> => ipcRenderer.invoke(CH.runtimeInstall, id),
    runFix: (id: string, command: string): Promise<boolean> =>
      ipcRenderer.invoke(CH.runtimeRunFix, id, command),
    detectExternal: (): Promise<number> => ipcRenderer.invoke(CH.runtimeDetectExternal),
    resync: (): Promise<{ adopted: number; recaptured: number; discarded: number }> =>
      ipcRenderer.invoke(CH.runtimeResync),
    requirements: (): Promise<Record<string, Requirement[]>> =>
      ipcRenderer.invoke(CH.runtimeRequirements),
    logs: (id: string): Promise<LogLine[]> => ipcRenderer.invoke(CH.logsGet, id),
    clearLogs: (id: string): Promise<void> => ipcRenderer.invoke(CH.logsClear, id),
    /** Tells idle auto-stop that this project is on screen right now. */
    touch: (id: string): Promise<void> => ipcRenderer.invoke(CH.runtimeTouch, id),
    onIdleStopped: (listener: (notice: IdleStopNotice) => void): (() => void) =>
      subscribe(CH.runtimeIdleStopped, listener),
    onChanged: (listener: (state: RuntimeState) => void): (() => void) =>
      subscribe(CH.runtimeChanged, listener),
    onLogs: (listener: (batch: LogBatch) => void): (() => void) =>
      subscribe(CH.logsAppended, listener),
    onReaped: (listener: (notice: ReapNotice) => void): (() => void) =>
      subscribe(CH.runtimeReaped, listener)
  },

  thumbs: {
    list: (): Promise<ThumbnailInfo[]> => ipcRenderer.invoke(CH.thumbsList),
    refresh: (id: string): Promise<boolean> => ipcRenderer.invoke(CH.thumbsRefresh, id),
    onChanged: (listener: (info: ThumbnailInfo) => void): (() => void) =>
      subscribe(CH.thumbsChanged, listener)
  },

  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(CH.settingsGet),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(CH.settingsSet, patch),
    onChanged: (listener: (settings: Settings) => void): (() => void) =>
      subscribe(CH.settingsChanged, listener)
  },

  system: {
    openExternal: (url: string): Promise<boolean> =>
      ipcRenderer.invoke(CH.systemOpenExternal, url),
    revealInFinder: (path: string): Promise<void> =>
      ipcRenderer.invoke(CH.systemRevealInFinder, path),
    contextMenu: (request: ContextMenuRequest): Promise<ContextMenuAction | null> =>
      ipcRenderer.invoke(CH.systemContextMenu, request),
    listeners: (): Promise<ListeningPort[]> => ipcRenderer.invoke(CH.systemListeners),
    freePort: (pid: number, port: number, command: string): Promise<boolean> =>
      ipcRenderer.invoke(CH.systemFreePort, pid, port, command),
    openInEditor: (projectId: string): Promise<EditorOpenResult> =>
      ipcRenderer.invoke(CH.systemOpenInEditor, projectId),
    pickDirectory: (title?: string): Promise<string | null> =>
      ipcRenderer.invoke(CH.systemPickDirectory, title)
  }
}

export type DevLaunchrApi = typeof api

contextBridge.exposeInMainWorld('devlaunchr', api)
