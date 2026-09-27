import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@shared/types'
import type { Requirement } from '@shared/ipc'
import { EXTERNAL_TOOLS, hasBinary, installCommandFor } from './toolchain'
import { inspectDependencies, nodePackageManager } from './dependencies'
import { venvExists } from './platform'

/** The first executable word of a shell command, ignoring env assignments. */
function leadingBinary(command: string): string | null {
  for (const raw of command.trim().split(/\s+/)) {
    const word = raw.replace(/^['"]|['"]$/g, '')
    if (!word) continue
    // FOO=bar prefixes, shell builtins, and path-y invocations are not tools
    // we could offer to install.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue
    if (['source', '.', 'cd', 'exec', 'env', 'sudo', 'nohup'].includes(word)) continue
    if (word.includes('/') || word.includes('\\')) return null
    return word
  }
  return null
}

const need = (
  name: string,
  reason: string,
  path?: string
): Requirement | null => {
  const tool = EXTERNAL_TOOLS[name]
  if (!tool) return null

  const present = hasBinary(name, path)
  return {
    name,
    label: tool.label,
    present,
    reason,
    installCommand: present ? null : installCommandFor(tool),
    docs: tool.docs
  }
}

/**
 * Everything a project needs on the machine before it can run, and whether it
 * is there.
 *
 * Checked up front rather than only after a failure: a project that needs
 * Docker, or PHP, or a package manager the user has never installed should say
 * so on its card, not after a confusing exit code. Project-local dependencies
 * (node_modules, a virtualenv, vendor/) are reported separately by
 * `inspectDependencies`; this is only the system-wide half.
 */
export function inspectRequirements(project: Project, path?: string): Requirement[] {
  const root = project.path
  const found: Requirement[] = []
  const seen = new Set<string>()

  const add = (requirement: Requirement | null): void => {
    if (!requirement || seen.has(requirement.name)) return
    seen.add(requirement.name)
    found.push(requirement)
  }

  switch (project.type) {
    case 'docker-compose':
      add(need('docker', 'This project is started with Docker Compose.', path))
      break

    case 'node-vite':
    case 'node-next':
    case 'node-generic': {
      add(need('node', 'Every Node project needs the Node runtime.', path))
      const manager = nodePackageManager(root)
      if (manager !== 'npm') {
        add(need(manager, `This project's lockfile is ${manager}'s.`, path))
      }
      break
    }

    case 'python-django':
    case 'python-flask':
    case 'python-generic': {
      const plan = inspectDependencies(project)
      if (plan.manager && plan.manager !== 'pip') {
        add(need(plan.manager, `This project's environment is managed by ${plan.manager}.`, path))
      }
      // A virtualenv brings its own interpreter; without one, a system Python
      // has to exist before anything can be created.
      if (!['.venv', 'venv', 'env'].some((folder) => venvExists(root, folder))) {
        add(need('python3', 'Needed to create this project’s virtual environment.', path))
      }
      break
    }

    case 'php':
      add(need('php', 'This project is served by PHP.', path))
      if (existsSync(join(root, 'composer.json'))) {
        add(need('composer', 'This project has a composer.json.', path))
      }
      break

    case 'static':
      // Served by devLaunchr itself; nothing external is required.
      break

    case 'custom':
      break
  }

  // Whatever the start command actually invokes, in case the project type does
  // not imply it — a Node project whose dev script shells out to `hugo`, say.
  const binary = leadingBinary(project.startCommand)
  if (binary && EXTERNAL_TOOLS[binary]) {
    add(need(binary, `This project's start command runs \`${binary}\`.`, path))
  }

  return found
}

/** The subset that is missing, which is what the UI acts on. */
export const missingRequirements = (project: Project, path?: string): Requirement[] =>
  inspectRequirements(project, path).filter((requirement) => !requirement.present)
