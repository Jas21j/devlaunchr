/**
 * Every IPC channel in the application, in one place.
 *
 * Main registers handlers from this map and preload calls them from the same
 * map, so a renamed channel is a type error rather than a runtime silence.
 */
export const CH = {
  appInfo: 'app:info',
  appGetTheme: 'app:getTheme',
  appSetTheme: 'app:setTheme',
  appThemeChanged: 'app:themeChanged',

  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsUpdate: 'projects:update',
  projectsRemove: 'projects:remove',
  projectsChanged: 'projects:changed',
  projectsPickFolder: 'projects:pickFolder',
  projectsInspect: 'projects:inspect',
  projectsScan: 'projects:scan',
  projectsScanCancel: 'projects:scanCancel',
  projectsScanProgress: 'projects:scanProgress',
  projectsAddMany: 'projects:addMany',

  runtimeStart: 'runtime:start',
  runtimeStop: 'runtime:stop',
  runtimeRestart: 'runtime:restart',
  runtimeStates: 'runtime:states',
  runtimeInstall: 'runtime:install',
  runtimeRunFix: 'runtime:runFix',
  runtimeDetectExternal: 'runtime:detectExternal',
  runtimeResync: 'runtime:resync',
  runtimeRequirements: 'runtime:requirements',
  runtimeChanged: 'runtime:changed',
  runtimeReaped: 'runtime:reaped',

  logsGet: 'logs:get',
  logsAppended: 'logs:appended',
  logsClear: 'logs:clear',

  thumbsList: 'thumbs:list',
  thumbsRefresh: 'thumbs:refresh',
  thumbsChanged: 'thumbs:changed',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',

  systemOpenExternal: 'system:openExternal',
  systemRevealInFinder: 'system:revealInFinder',
  systemContextMenu: 'system:contextMenu',
  systemListeners: 'system:listeners',
  systemFreePort: 'system:freePort'
} as const

export type Channel = (typeof CH)[keyof typeof CH]

/** What the folder picker hands back: the path plus what we inferred about it. */
export interface FolderPick {
  path: string
  name: string
  alreadyAdded: boolean
  detection: Detection
}

export interface Detection {
  type: import('./types').ProjectType
  startCommand: string
  installCommand: string | null
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null
  /** Human-readable reason the type was chosen, shown in the editor. */
  reason: string
  /** Types that also matched but lost the priority chain. */
  alternatives: Array<{ type: import('./types').ProjectType; startCommand: string; reason: string }>
  warnings: string[]
}

/** The fields a caller may supply when adding a project. */
export interface NewProjectInput {
  name: string
  path: string
  type: import('./types').ProjectType
  startCommand: string
  installCommand?: string
  preferredPort: number | null
  env: Record<string, string>
  autoOpen: boolean
  favorite: boolean
  notes?: string
}

export type ProjectPatch = Partial<Omit<NewProjectInput, 'path'>> & {
  lastOpenedAt?: string | null
}

export interface ScanCandidate {
  path: string
  name: string
  detection: Detection
  alreadyAdded: boolean
  modifiedAt: number
}

export interface ScanProgress {
  scanned: number
  found: number
  current: string
}

export interface ScanResult {
  candidates: ScanCandidate[]
  roots: string[]
  /** Folders macOS refused to read — the scan is incomplete without these. */
  denied: string[]
  durationMs: number
  cancelled: boolean
}

export interface LogBatch {
  projectId: string
  lines: import('./types').LogLine[]
}

/** Reported once at boot when a previous session left processes behind. */
export interface ReapNotice {
  reaped: Array<{ name: string; pid: number; port: number | null }>
}

export type DiagnosisAction =
  | { kind: 'install'; label: string }
  | { kind: 'run'; label: string; command: string }
  | { kind: 'copy'; label: string; value: string }
  | { kind: 'docs'; label: string; url: string }
  | { kind: 'edit'; label: string }
  | { kind: 'ports'; label: string }

export interface Requirement {
  /** The binary devLaunchr looks for on PATH. */
  name: string
  label: string
  present: boolean
  /** Why this project needs it. */
  reason: string
  /** The command that would install it here, when one is available. */
  installCommand: string | null
  docs: string | null
}

export interface Diagnosis {
  title: string
  detail: string
  actions: DiagnosisAction[]
}

export interface ListeningPort {
  port: number
  pid: number
  command: string
  address: string
  user: string
  /** Where a browser reaches this socket: its own address, not "localhost". */
  url: string
  /** Set when this port belongs to a project devLaunchr started. */
  projectId: string | null
  projectName: string | null
}

export interface ThumbnailInfo {
  projectId: string
  url: string
  capturedAt: number
  /** True when the image came from a file in the project, not a screenshot. */
  fromDisk: boolean
}

export type ContextMenuAction =
  | 'start'
  | 'stop'
  | 'restart'
  | 'openExternal'
  | 'copyUrl'
  | 'revealInFinder'
  | 'openInEditor'
  | 'edit'
  | 'toggleFavorite'
  | 'remove'

export interface ContextMenuRequest {
  projectId: string
  favorite: boolean
  canStart: boolean
  canStop: boolean
  hasUrl: boolean
}
