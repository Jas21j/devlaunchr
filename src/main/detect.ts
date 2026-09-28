import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Detection } from '@shared/ipc'
import { nodePackageManager, portFromCommand, type PackageManager } from './dependencies'
import { venvActivate, venvExists } from './platform'

interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packageManager?: string
}

const has = (dir: string, ...names: string[]): boolean =>
  names.some((name) => existsSync(join(dir, name)))

function readPackageJson(dir: string): PackageJson | null {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as PackageJson
  } catch {
    // A malformed package.json is still a signal that this is a Node project;
    // we just can't read its scripts.
    return {}
  }
}

const runScript = (pm: PackageManager, script: string): string =>
  pm === 'npm' || pm === 'bun' ? `${pm} run ${script}` : `${pm} ${script}`

const installFor = (pm: PackageManager): string => (pm === 'npm' ? 'npm install' : `${pm} install`)

/**
 * Python entry points only resolve if the interpreter comes from the project's
 * own environment. Without this, every `python-*` project fails on the first
 * start with an import error that looks like the app's fault.
 */
function pythonPrefix(dir: string): { prefix: string; note: string } | null {
  if (has(dir, 'uv.lock')) return { prefix: 'uv run ', note: 'uv.lock present' }
  if (has(dir, 'poetry.lock')) return { prefix: 'poetry run ', note: 'poetry.lock present' }
  for (const venv of ['.venv', 'venv', 'env']) {
    if (venvExists(dir, venv)) {
      return { prefix: venvActivate(venv), note: `${venv}/ virtualenv` }
    }
  }
  return null
}

/**
 * Detect a single folder. The priority chain follows the spec with one
 * correction: a compose file does NOT outrank package.json or manage.py.
 * Most web repos ship compose purely for a database, and `docker compose up`
 * would start Postgres and never start the site. Compose wins only when there
 * is no application manifest, and is offered as an alternative otherwise.
 */
/**
 * Many dev scripts pin their own port and ignore $PORT. Surfacing that as the
 * project's preferred port means devLaunchr reserves the port the project will
 * actually use, instead of assigning one it will discard.
 */
export function pinnedPort(startCommand: string): number | null {
  const { port, honorsEnv } = portFromCommand(startCommand)
  return honorsEnv ? null : port
}

export function detectProject(dir: string): Detection {
  const warnings: string[] = []
  const alternatives: Detection['alternatives'] = []

  const pkg = readPackageJson(dir)
  const compose = has(dir, 'docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml')
  const django = has(dir, 'manage.py')
  const flask = has(dir, 'app.py', 'wsgi.py', 'application.py')
  const php = has(dir, 'composer.json', 'index.php')
  const staticSite = has(dir, 'index.html')

  if (compose) {
    alternatives.push({
      type: 'docker-compose',
      startCommand: 'docker compose up',
      reason: 'compose file present'
    })
  }

  if (pkg) {
    const pm = nodePackageManager(dir, pkg)
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const scripts = pkg.scripts ?? {}
    const install = installFor(pm)

    if (has(dir, '.nvmrc', '.node-version')) {
      warnings.push(
        'This project pins a Node version (.nvmrc). nvm is a shell function, ' +
          'so the pinned version will not be applied automatically.'
      )
    }

    const base = {
      installCommand: install,
      packageManager: pm,
      alternatives,
      warnings
    }

    if (deps['next']) {
      return { ...base, type: 'node-next', startCommand: runScript(pm, 'dev'), reason: 'next dependency' }
    }
    if (deps['vite']) {
      return { ...base, type: 'node-vite', startCommand: runScript(pm, 'dev'), reason: 'vite dependency' }
    }
    if (scripts['dev']) {
      return { ...base, type: 'node-generic', startCommand: runScript(pm, 'dev'), reason: 'dev script' }
    }
    if (scripts['start']) {
      return { ...base, type: 'node-generic', startCommand: runScript(pm, 'start'), reason: 'start script' }
    }
    if (scripts['serve']) {
      return { ...base, type: 'node-generic', startCommand: runScript(pm, 'serve'), reason: 'serve script' }
    }

    warnings.push('package.json has no dev, start, or serve script — set a start command manually.')
    return { ...base, type: 'custom', startCommand: '', reason: 'package.json without a runnable script' }
  }

  if (django) {
    const venv = pythonPrefix(dir)
    if (!venv) warnings.push('No virtualenv found — the system Python will be used.')
    return {
      type: 'python-django',
      startCommand: `${venv?.prefix ?? ''}python manage.py runserver 127.0.0.1:$PORT`,
      installCommand: venv ? null : 'pip install -r requirements.txt',
      packageManager: null,
      reason: venv ? `manage.py (${venv.note})` : 'manage.py',
      alternatives,
      warnings
    }
  }

  if (flask) {
    const venv = pythonPrefix(dir)
    if (!venv) warnings.push('No virtualenv found — the system Python will be used.')
    return {
      type: 'python-flask',
      startCommand: `${venv?.prefix ?? ''}flask run --port $PORT`,
      installCommand: venv ? null : 'pip install -r requirements.txt',
      packageManager: null,
      reason: venv ? `app.py (${venv.note})` : 'app.py',
      alternatives,
      warnings
    }
  }

  const pythonProject = has(dir, 'pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py')

  if (compose) {
    return {
      type: 'docker-compose',
      startCommand: 'docker compose up',
      installCommand: null,
      packageManager: null,
      reason: 'compose file, no application manifest',
      alternatives: [],
      warnings
    }
  }

  if (pythonProject) {
    const venv = pythonPrefix(dir)
    warnings.push('Python project with no recognizable entry point — set a start command.')
    return {
      type: 'python-generic',
      startCommand: '',
      installCommand: venv ? null : 'pip install -r requirements.txt',
      packageManager: null,
      reason: venv ? `Python project (${venv.note})` : 'Python project',
      alternatives,
      warnings
    }
  }

  if (php) {
    return {
      type: 'php',
      startCommand: 'php -S 127.0.0.1:$PORT',
      installCommand: has(dir, 'composer.json') ? 'composer install' : null,
      packageManager: null,
      reason: has(dir, 'composer.json') ? 'composer.json' : 'index.php',
      alternatives,
      warnings
    }
  }

  if (staticSite) {
    return {
      type: 'static',
      startCommand: '',
      installCommand: null,
      packageManager: null,
      reason: 'index.html at root — served by the built-in static server',
      alternatives,
      warnings
    }
  }

  warnings.push('No recognizable project markers found. Set a start command manually.')
  return {
    type: 'custom',
    startCommand: '',
    installCommand: null,
    packageManager: null,
    reason: 'no markers',
    alternatives,
    warnings
  }
}
