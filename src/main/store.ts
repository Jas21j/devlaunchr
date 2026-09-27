import { randomUUID } from 'node:crypto'
import { basename, resolve as resolvePath } from 'node:path'
import { EventEmitter } from 'node:events'
import Store from 'electron-store'
import { DEFAULT_SETTINGS, type Project, type ProjectType, type Settings } from '@shared/types'
import type { NewProjectInput, ProjectPatch } from '@shared/ipc'
import { defaultRoots } from './scanner'

interface Schema {
  schemaVersion: number
  projects: Project[]
  settings: Settings
}

const CURRENT_SCHEMA_VERSION = 1

const PROJECT_TYPES: ReadonlySet<string> = new Set<ProjectType>([
  'node-vite', 'node-next', 'node-generic',
  'python-django', 'python-flask', 'python-generic',
  'php', 'static', 'docker-compose', 'custom'
])

/**
 * Persistence is deliberately validated in TypeScript rather than through
 * electron-store's ajv schema. A strict schema throws on load, which would turn
 * one hand-edited or partially-written config.json into an app that refuses to
 * start. Normalizing instead means a damaged entry degrades to a sane default
 * and the user keeps their other projects.
 */
const store = new Store<Schema>({
  name: 'config',
  defaults: {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projects: [],
    settings: { ...DEFAULT_SETTINGS, watchRoots: defaultRoots() }
  },
  clearInvalidConfig: true
})

export const emitter = new EventEmitter()

export const configPath = (): string => store.path

// ---------------------------------------------------------------- normalizing

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

function port(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= 1 && value <= 65535 ? value : null
}

function envMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' && key.length > 0) out[key] = raw
  }
  return out
}

/** Returns null for an entry too damaged to be useful (no id or no path). */
function normalizeProject(raw: unknown): Project | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const path = str(r['path'])
  if (!path) return null

  const type = str(r['type'])
  return {
    id: str(r['id']) || randomUUID(),
    name: str(r['name']) || basename(path),
    path,
    type: (PROJECT_TYPES.has(type) ? type : 'custom') as ProjectType,
    startCommand: str(r['startCommand']),
    ...(typeof r['installCommand'] === 'string' ? { installCommand: r['installCommand'] } : {}),
    preferredPort: port(r['preferredPort']),
    env: envMap(r['env']),
    autoOpen: bool(r['autoOpen'], false),
    favorite: bool(r['favorite'], false),
    lastOpenedAt: typeof r['lastOpenedAt'] === 'string' ? r['lastOpenedAt'] : null,
    ...(typeof r['notes'] === 'string' ? { notes: r['notes'] } : {})
  }
}

function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const pm = str(r['defaultPackageManager'])
  const theme = str(r['theme'])
  const editor = str(r['editor'])

  const start = port(r['portRangeStart']) ?? DEFAULT_SETTINGS.portRangeStart
  const end = port(r['portRangeEnd']) ?? DEFAULT_SETTINGS.portRangeEnd

  return {
    watchRoots: Array.isArray(r['watchRoots'])
      ? [...new Set(r['watchRoots'].filter((v): v is string => typeof v === 'string'))]
      : defaultRoots(),
    hasCompletedFirstScan: bool(r['hasCompletedFirstScan'], false),
    scanMaxDepth: Math.min(
      Math.max(typeof r['scanMaxDepth'] === 'number' ? r['scanMaxDepth'] : DEFAULT_SETTINGS.scanMaxDepth, 1),
      8
    ),
    portRangeStart: Math.min(start, end),
    portRangeEnd: Math.max(start, end),
    defaultPackageManager:
      pm === 'pnpm' || pm === 'yarn' || pm === 'bun' ? pm : 'npm',
    healthCheckTimeoutMs: Math.min(
      Math.max(
        typeof r['healthCheckTimeoutMs'] === 'number'
          ? r['healthCheckTimeoutMs']
          : DEFAULT_SETTINGS.healthCheckTimeoutMs,
        5_000
      ),
      300_000
    ),
    launchAtLogin: bool(r['launchAtLogin'], false),
    autoStopIdleMinutes:
      typeof r['autoStopIdleMinutes'] === 'number' && r['autoStopIdleMinutes'] > 0
        ? r['autoStopIdleMinutes']
        : null,
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    editor:
      editor === 'cursor' || editor === 'zed' || editor === 'sublime' || editor === 'custom'
        ? editor
        : 'vscode',
    editorCustomCommand: str(r['editorCustomCommand']),
    autoInstall: bool(r["autoInstall"], true)
  }
}

// ------------------------------------------------------------------- projects

export function getProjects(): Project[] {
  const raw = store.get('projects') as unknown
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeProject).filter((p): p is Project => p !== null)
}

function writeProjects(projects: Project[]): void {
  store.set('projects', projects)
  emitter.emit('projects', projects)
}

/** Absolute, symlink-free-ish, trailing-slash-free — so path equality is real. */
const canonical = (path: string): string => resolvePath(path).replace(/\/+$/, '')

export function findByPath(path: string): Project | undefined {
  const target = canonical(path)
  return getProjects().find((p) => canonical(p.path) === target)
}

export class DuplicateProjectError extends Error {
  constructor(public readonly existing: Project) {
    super(`A project at ${existing.path} is already in the list.`)
    this.name = 'DuplicateProjectError'
  }
}

export function addProject(input: NewProjectInput): Project {
  const existing = findByPath(input.path)
  if (existing) throw new DuplicateProjectError(existing)

  const project: Project = {
    id: randomUUID(),
    name: input.name.trim() || basename(canonical(input.path)),
    path: canonical(input.path),
    type: input.type,
    startCommand: input.startCommand,
    ...(input.installCommand ? { installCommand: input.installCommand } : {}),
    preferredPort: input.preferredPort,
    env: input.env,
    autoOpen: input.autoOpen,
    favorite: input.favorite,
    lastOpenedAt: null,
    ...(input.notes ? { notes: input.notes } : {})
  }

  writeProjects([...getProjects(), project])
  return project
}

/**
 * Adds only entries whose path is not already present. Used by the scanner so
 * a re-scan can never clobber a project the user has customized.
 */
export function addProjectsIfNew(inputs: NewProjectInput[]): Project[] {
  const added: Project[] = []
  for (const input of inputs) {
    if (findByPath(input.path)) continue
    added.push(addProject(input))
  }
  return added
}

export function updateProject(id: string, patch: ProjectPatch): Project | null {
  const projects = getProjects()
  const index = projects.findIndex((p) => p.id === id)
  if (index === -1) return null

  const current = projects[index]
  if (!current) return null

  const next: Project = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.startCommand !== undefined ? { startCommand: patch.startCommand } : {}),
    ...(patch.installCommand !== undefined ? { installCommand: patch.installCommand } : {}),
    ...(patch.preferredPort !== undefined ? { preferredPort: port(patch.preferredPort) } : {}),
    ...(patch.env !== undefined ? { env: envMap(patch.env) } : {}),
    ...(patch.autoOpen !== undefined ? { autoOpen: patch.autoOpen } : {}),
    ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.lastOpenedAt !== undefined ? { lastOpenedAt: patch.lastOpenedAt } : {})
  }

  projects[index] = next
  writeProjects(projects)
  return next
}

export function removeProject(id: string): boolean {
  const projects = getProjects()
  const next = projects.filter((p) => p.id !== id)
  if (next.length === projects.length) return false
  writeProjects(next)
  return true
}

// ------------------------------------------------------------------- settings

export function getSettings(): Settings {
  return normalizeSettings(store.get('settings'))
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = normalizeSettings({ ...getSettings(), ...patch })
  store.set('settings', next)
  emitter.emit('settings', next)
  return next
}

// ----------------------------------------------------------------- migrations

/**
 * Run once at boot. Kept explicit rather than using electron-store's own
 * migration hook so that a migration failure is visible and recoverable
 * instead of throwing during module load.
 */
export function migrate(): void {
  const version = store.get('schemaVersion') as unknown
  if (typeof version === 'number' && version >= CURRENT_SCHEMA_VERSION) return

  // v0 → v1: normalize every record and canonicalize stored paths.
  const projects = getProjects().map((p) => ({ ...p, path: canonical(p.path) }))
  store.set('projects', projects)
  store.set('settings', getSettings())
  store.set('schemaVersion', CURRENT_SCHEMA_VERSION)
}
