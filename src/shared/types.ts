/**
 * Types shared across the main, preload, and renderer processes.
 * This file must stay dependency-free so every process can import it.
 */

/**
 * `installing` is an addition to the spec's set: without it, a first run of a
 * freshly cloned project looks identical to a crash, and the user is shown an
 * exit code instead of the one action that fixes it.
 */
export type ProjectStatus =
  | 'stopped'
  | 'installing'
  | 'starting'
  | 'running'
  | 'crashed'
  | 'stopping'

export type ProjectType =
  | 'node-vite'
  | 'node-next'
  | 'node-generic'
  | 'python-django'
  | 'python-flask'
  | 'python-generic'
  | 'php'
  | 'static'
  | 'docker-compose'
  | 'custom'

export interface Project {
  id: string
  name: string
  path: string
  type: ProjectType
  startCommand: string
  installCommand?: string
  preferredPort: number | null
  env: Record<string, string>
  autoOpen: boolean
  favorite: boolean
  lastOpenedAt: string | null
  notes?: string
}

/**
 * In-memory only. Never persisted to disk.
 *
 * Log lines are deliberately NOT part of this snapshot: status changes are
 * frequent and the buffer holds up to 2000 lines, so carrying them here would
 * push the entire log across IPC on every transition. Logs travel separately
 * as incremental batches.
 */
export interface RuntimeState {
  projectId: string
  status: ProjectStatus
  pid: number | null
  port: number | null
  url: string | null
  startedAt: number | null
  lastError: string | null
  /** True when the project cannot run until its dependencies are installed. */
  needsInstall: boolean
  /** Set when a start failed because something else already holds the port. */
  conflict: PortConflict | null
  /** A plain-language cause and next step for the most recent failure. */
  diagnosis: import('./ipc').Diagnosis | null
  /**
   * Set when this server is already running but devLaunchr did not start it —
   * adopted from a terminal, an IDE, or another tool.
   */
  external: ExternalOwner | null
}

export interface ExternalOwner {
  pid: number
  command: string
  /** How devLaunchr recognised it: working directory, command line, or port. */
  matchedBy: 'cwd' | 'commandLine'
}

export interface PortConflict {
  port: number
  /** The process holding it, when we could identify one. */
  pid: number | null
  command: string | null
  /** True when the project pinned this port itself rather than using $PORT. */
  hardcoded: boolean
}

export interface LogLine {
  ts: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export type ThemePreference = 'system' | 'light' | 'dark'

export type EditorId = 'vscode' | 'cursor' | 'zed' | 'sublime' | 'custom'

export interface Settings {
  watchRoots: string[]
  scanMaxDepth: number
  /** Set once the first-run scan has been shown, so it never reappears. */
  hasCompletedFirstScan: boolean
  portRangeStart: number
  portRangeEnd: number
  defaultPackageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  healthCheckTimeoutMs: number
  launchAtLogin: boolean
  autoStopIdleMinutes: number | null
  theme: ThemePreference
  editor: EditorId
  editorCustomCommand: string
  /** Install missing dependencies automatically when starting a project. */
  autoInstall: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  watchRoots: [],
  scanMaxDepth: 5,
  hasCompletedFirstScan: false,
  portRangeStart: 3000,
  portRangeEnd: 3999,
  defaultPackageManager: 'npm',
  healthCheckTimeoutMs: 60_000,
  launchAtLogin: false,
  autoStopIdleMinutes: null,
  theme: 'system',
  editor: 'vscode',
  editorCustomCommand: '',
  autoInstall: true
}

/** App-level info the renderer shows but cannot derive on its own. */
export interface AppInfo {
  version: string
  electronVersion: string
  platform: NodeJS.Platform
  configPath: string
  home: string
  /** Whether the OS lets an app register itself to open at login. */
  loginItemSupported: boolean
}
