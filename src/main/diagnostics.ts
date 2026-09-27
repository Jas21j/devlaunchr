import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@shared/types'
import type { Diagnosis, DiagnosisAction } from '@shared/ipc'
import { inspectDependencies } from './dependencies'
import { IS_MAC, IS_WINDOWS } from './platform'
import { EXTERNAL_TOOLS, installCommandFor, systemPackageManager } from './toolchain'

/**
 * Matches the shell's own "not found" wording.
 *
 * Order matters: zsh puts the command name AFTER the phrase
 * (`zsh:1: command not found: docker`) while bash and sh put it before
 * (`sh: astro: command not found`). Testing the bash shape first against zsh's
 * output captures the line number instead of the command.
 */
const NOT_FOUND = [
  /command not found:\s*([\w.@/+-]+)/i,
  /(?:^|\n)(?:[^\n:]*:\s*)??(?:line \d+:\s*)?([\w.@/+-]+):\s*command not found/i,
  /(?:^|\n)([\w.@/+-]+):\s*not found/i,
  /'([\w.@/+-]+)' is not recognized as an internal or external command/i,
  /The term '([\w.@/+-]+)' is not recognized/i
]

function missingCommand(logs: string): string | null {
  for (const pattern of NOT_FOUND) {
    const name = pattern.exec(logs)?.[1]
    // A bare number is a line reference the pattern picked up, not a command.
    if (name && !/^\d+$/.test(name)) return name
  }
  return null
}

export interface DiagnoseInput {
  project: Project
  exitCode: number | null
  signal: string | null
  logs: string
}

const installAction = (command: string | null): DiagnosisAction[] =>
  command ? [{ kind: 'install', label: `Run ${command}` }] : []

/**
 * Turns a failure into a cause and a next step.
 *
 * Every branch here exists because a real project produced that exact output
 * and the raw text was useless on its own. An exit code is not a diagnosis;
 * "Docker is not installed" is.
 */
export function diagnose(input: DiagnoseInput): Diagnosis | null {
  const { project, exitCode, logs } = input
  const plan = inspectDependencies(project)

  // ---------------------------------------------------- missing executable
  const missing = missingCommand(logs)
  if (missing) {
    const tool = EXTERNAL_TOOLS[missing.toLowerCase()]
    if (tool) {
      const command = installCommandFor(tool)
      const manager = systemPackageManager()

      return {
        title: `${tool.label} is not installed`,
        detail: command
          ? `This project runs \`${missing}\`, which is not on your PATH. devLaunchr can install it with \`${command}\`, or you can follow the official instructions.`
          : `This project runs \`${missing}\`, which is not on your PATH. Install it, then start the project again.`,
        actions: [
          // The command runs in the log pane where its output is visible, and
          // only ever installs the tool the project actually asked for.
          ...(command
            ? [
                {
                  kind: 'run' as const,
                  label: `Install ${tool.label}${manager === 'brew' ? ' with Homebrew' : ''}`,
                  command
                },
                { kind: 'copy' as const, label: 'Copy command', value: command }
              ]
            : []),
          { kind: 'docs' as const, label: `${tool.label} install guide`, url: tool.docs }
        ]
      }
    }

    // Not a system tool, so it is almost certainly a binary that should have
    // come from the project's own dependencies.
    if (plan.missing) {
      return {
        title: `${missing} is missing because dependencies are not installed`,
        detail: plan.reason,
        actions: installAction(project.installCommand?.trim() || plan.command)
      }
    }

    return {
      title: `${missing} could not be found`,
      detail:
        'Dependencies appear to be installed, so either the command is misspelled or it needs a global install. Reinstalling the project dependencies usually fixes it.',
      actions: [
        ...installAction(project.installCommand?.trim() || plan.command),
        { kind: 'edit', label: 'Edit start command' }
      ]
    }
  }

  // ------------------------------------------- electron binary not unpacked
  if (/ENOENT/.test(logs) && /node_modules[/\\]electron[/\\]dist/.test(logs)) {
    const manager = project.installCommand?.split(' ')[0] ?? 'npm'
    const command = manager === 'npm' ? 'npm rebuild electron' : `${manager} rebuild electron`
    return {
      title: "Electron's binary was never downloaded",
      detail:
        'The electron package is installed but its actual runtime is missing — usually a postinstall script that was skipped or blocked by a proxy. Rebuilding the package downloads it.',
      actions: [{ kind: 'run', label: `Run ${command}`, command }]
    }
  }

  // ------------------------------------------------- missing Node module
  const nodeModule = /Cannot find module ['"]([^'"]+)['"]/.exec(logs)?.[1]
  if (nodeModule && !nodeModule.startsWith('.')) {
    return {
      title: `The package ${nodeModule} is not installed`,
      detail: plan.missing
        ? plan.reason
        : `${nodeModule} is imported but missing from node_modules. Reinstalling dependencies usually restores it.`,
      actions: installAction(project.installCommand?.trim() || plan.command || 'npm install')
    }
  }

  // ------------------------------------------------ missing Python module
  const pyModule = /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/.exec(logs)?.[1]
  if (pyModule) {
    return {
      title: `The Python package ${pyModule} is not installed`,
      detail:
        plan.reason ||
        `${pyModule} is imported but not present in this project's environment.`,
      actions: installAction(project.installCommand?.trim() || plan.command)
    }
  }

  // --------------------------------------------------- privileged port
  if (/EACCES/.test(logs) && /listen|bind|permission denied/i.test(logs)) {
    return {
      title: 'Permission denied binding that port',
      detail:
        'Ports below 1024 need elevated privileges. Set a preferred port of 1024 or higher for this project, or change the port in the project\'s own configuration.',
      actions: [{ kind: 'edit', label: 'Edit project' }]
    }
  }

  // ------------------------------------------------- node version mismatch
  const engineRange = /(?:requires|expected) Node(?:\.js)? version ["']?([^"'\n,]+)/i.exec(logs)?.[1]
  if (engineRange || /Unsupported engine|EBADENGINE/.test(logs)) {
    return {
      title: 'This project needs a different Node version',
      detail: `${
        engineRange ? `It asks for Node ${engineRange.trim()}. ` : ''
      }devLaunchr runs projects through your login shell, so it uses whatever Node that shell resolves to — version managers like nvm are shell functions and are not applied automatically.`,
      actions: [{ kind: 'edit', label: 'Edit start command' }]
    }
  }

  // -------------------------------------------------- dependencies missing
  if (plan.missing) {
    return {
      title: 'Dependencies are not installed',
      detail: plan.reason,
      actions: installAction(project.installCommand?.trim() || plan.command)
    }
  }

  // --------------------------------------- a compose file but no daemon
  if (project.type === 'docker-compose' && /Cannot connect to the Docker daemon/i.test(logs)) {
    return {
      title: 'Docker is installed but not running',
      detail: 'Start Docker Desktop, wait for it to finish starting, then try again.',
      actions: [{ kind: 'docs', label: 'Docker docs', url: 'https://docs.docker.com/desktop/' }]
    }
  }

  // ------------------------------------------------------ script missing
  if (/missing script:\s*(\S+)/i.test(logs)) {
    // npm prints the name already quoted; keeping its quotes would double them.
    const script = /missing script:\s*"?([^"\s]+)"?/i.exec(logs)?.[1]
    return {
      title: `This project has no "${script}" script`,
      detail:
        'The start command runs a package script that does not exist in package.json. Pick a different command.',
      actions: [{ kind: 'edit', label: 'Edit start command' }]
    }
  }

  // ------------------------------------------------------------- generic
  if (exitCode === 127) {
    return {
      title: 'The start command could not be run',
      detail: 'The shell could not find the program this project starts with.',
      actions: [{ kind: 'edit', label: 'Edit start command' }]
    }
  }

  return null
}

/** True when a project is a desktop app rather than a web server. */
export function isDesktopApp(project: Project): boolean {
  if (project.type !== 'node-vite' && project.type !== 'node-generic') return false
  try {
    const pkgPath = join(project.path, 'package.json')
    if (!existsSync(pkgPath)) return false
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw: unknown = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return false
    const pkg = raw as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    return Boolean(deps['electron'] || deps['@tauri-apps/cli'] || deps['electron-vite'])
  } catch {
    return false
  }
}

export const platformNote = IS_WINDOWS ? 'windows' : IS_MAC ? 'mac' : 'linux'
