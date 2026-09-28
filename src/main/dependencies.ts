import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, ProjectType } from '@shared/types'
import { IS_WINDOWS, VENV_BIN, venvExists } from './platform'

export interface DependencyPlan {
  /** True when the project cannot run until something is installed. */
  missing: boolean
  /** The command that would install them, or null when we cannot tell. */
  command: string | null
  /** Tool the command drives — shown in the UI, e.g. "npm", "uv", "composer". */
  manager: string | null
  /** One sentence naming what is missing. */
  reason: string
}

const NONE: DependencyPlan = { missing: false, command: null, manager: null, reason: '' }

const has = (root: string, ...names: string[]): boolean =>
  names.some((name) => existsSync(join(root, name)))

// ------------------------------------------------------------------- node

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/**
 * The manager used when a project names none and has no lockfile — the
 * user's "default package manager" setting. Held here rather than read from
 * the store so detection stays free of an import cycle.
 */
let fallbackManager: PackageManager = 'npm'

export function setFallbackPackageManager(manager: PackageManager): void {
  fallbackManager = manager
}

/**
 * Which package manager a Node project uses: its `packageManager` field
 * first, then its lockfile, then the user's default. Pass `pkg` when the
 * caller has already parsed package.json.
 */
export function nodePackageManager(root: string, pkg?: { packageManager?: string } | null): PackageManager {
  let manifest = pkg
  if (manifest === undefined) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      manifest = typeof parsed === 'object' && parsed !== null ? (parsed as { packageManager?: string }) : null
    } catch {
      manifest = null
    }
  }
  const declared = manifest?.packageManager?.split('@')[0]
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') {
    return declared
  }
  if (has(root, 'pnpm-lock.yaml')) return 'pnpm'
  if (has(root, 'yarn.lock')) return 'yarn'
  if (has(root, 'bun.lockb', 'bun.lock')) return 'bun'
  if (has(root, 'package-lock.json')) return 'npm'
  return fallbackManager
}

const NODE_TYPES = new Set<ProjectType>(['node-vite', 'node-next', 'node-generic'])
const PYTHON_TYPES = new Set<ProjectType>([
  'python-django',
  'python-flask',
  'python-generic'
])

// ----------------------------------------------------------------- python

/**
 * Python is the awkward one: there is no single answer, so the lockfile that
 * is present decides the tool, and a bare requirements.txt gets an explicit
 * virtualenv rather than installing into the system interpreter.
 */
function pythonPlan(root: string): DependencyPlan {
  if (has(root, 'uv.lock')) {
    return venvExists(root, '.venv')
      ? NONE
      : {
          missing: true,
          command: 'uv sync',
          manager: 'uv',
          reason: 'This project uses uv and has no .venv yet.'
        }
  }

  if (has(root, 'poetry.lock')) {
    return venvExists(root, '.venv')
      ? NONE
      : {
          missing: true,
          command: 'poetry install',
          manager: 'poetry',
          reason: 'This project uses Poetry and has no environment yet.'
        }
  }

  if (has(root, 'Pipfile')) {
    return venvExists(root, '.venv')
      ? NONE
      : {
          missing: true,
          command: 'pipenv install',
          manager: 'pipenv',
          reason: 'This project uses Pipenv and has no environment yet.'
        }
  }

  const requirements = ['requirements.txt', 'requirements-dev.txt'].find((name) =>
    existsSync(join(root, name))
  )

  if (requirements) {
    if (['.venv', 'venv', 'env'].some((folder) => venvExists(root, folder))) return NONE
    return {
      missing: true,
      command: IS_WINDOWS
        ? `python -m venv .venv; .\\.venv\\${VENV_BIN}\\pip install -r ${requirements}`
        : `python3 -m venv .venv && ./.venv/${VENV_BIN}/pip install -r ${requirements}`,
      manager: 'pip',
      // Installing into the system Python is how people end up with a broken
      // one, so the virtualenv is created rather than assumed.
      reason: `${requirements} is present but there is no virtualenv.`
    }
  }

  if (has(root, 'pyproject.toml')) {
    return venvExists(root, '.venv')
      ? NONE
      : {
          missing: true,
          command: IS_WINDOWS
            ? `python -m venv .venv; .\\.venv\\${VENV_BIN}\\pip install -e .`
            : `python3 -m venv .venv && ./.venv/${VENV_BIN}/pip install -e .`,
          manager: 'pip',
          reason: 'pyproject.toml is present but there is no virtualenv.'
        }
  }

  return NONE
}

// ------------------------------------------------------------------ public

/**
 * What, if anything, this project needs installed before it can run.
 *
 * Deliberately ecosystem-shaped rather than Node-only: a Django project with
 * no virtualenv fails exactly as confusingly as a Node project with no
 * node_modules, and both are the normal state of a freshly cloned repo.
 */
export function inspectDependencies(project: Project): DependencyPlan {
  const root = project.path
  if (!existsSync(root)) return NONE

  if (NODE_TYPES.has(project.type)) {
    if (!existsSync(join(root, 'package.json'))) return NONE
    if (existsSync(join(root, 'node_modules'))) return NONE

    const manager = nodePackageManager(root)
    return {
      missing: true,
      command: manager === 'npm' ? 'npm install' : `${manager} install`,
      manager,
      reason: 'package.json is present but node_modules has not been installed.'
    }
  }

  if (PYTHON_TYPES.has(project.type)) return pythonPlan(root)

  if (project.type === 'php') {
    if (!existsSync(join(root, 'composer.json'))) return NONE
    if (existsSync(join(root, 'vendor'))) return NONE
    return {
      missing: true,
      command: 'composer install',
      manager: 'composer',
      reason: 'composer.json is present but vendor/ has not been installed.'
    }
  }

  // Static folders and compose stacks have nothing to install.
  return NONE
}

// ----------------------------------------------------- hardcoded port hints

const PORT_FLAGS = [
  /--port[= ](\d{2,5})\b/,
  /\s-p[= ](\d{2,5})\b/,
  /--port[= ]\$\{?PORT\}?/,
  /:\$\{?PORT\}?/
]

/**
 * Reads a port out of a start command.
 *
 * Plenty of dev scripts pin their own port — `astro dev --port 4321`,
 * `node serve.mjs --port 3000` — and ignore $PORT entirely. Knowing that up
 * front lets devLaunchr reserve the port the project will actually use instead
 * of assigning one it will ignore.
 */
export function portFromCommand(command: string): { port: number | null; honorsEnv: boolean } {
  const honorsEnv = /\$\{?PORT\}?/.test(command)

  for (const pattern of PORT_FLAGS) {
    const match = pattern.exec(command)
    const value = match?.[1]
    if (!value) continue
    const port = Number.parseInt(value, 10)
    if (port >= 1 && port <= 65535) return { port, honorsEnv }
  }

  return { port: null, honorsEnv }
}
