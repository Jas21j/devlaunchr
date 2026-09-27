import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@shared/types'
import { portFromCommand } from './dependencies'

/**
 * The port contract for the dev servers people actually use.
 *
 * Vite, Astro, Nuxt and SvelteKit ignore $PORT. Left alone, every Vite project
 * starts on 5173 and every Astro project on 4321, binds "localhost" (which is
 * ::1 on modern macOS), and quietly shares a port with whichever project got
 * there first. The preview then shows the wrong site.
 *
 * So when a project's start command is a plain package-manager script that
 * runs one of these frameworks, devLaunchr passes the port it assigned and a
 * specific loopback address explicitly. Vite additionally gets --strictPort, so
 * a collision fails loudly instead of drifting to 5174.
 *
 * Anything devLaunchr cannot read with confidence — a custom command, a script
 * that already chooses its own port, a compound script run through
 * concurrently or turbo — is passed through untouched.
 */

type Framework = 'vite' | 'astro' | 'next' | 'nuxt'

const FLAGS: Record<Framework, string> = {
  vite: '--port $PORT --strictPort --host 127.0.0.1',
  astro: '--port $PORT --host 127.0.0.1',
  next: '--port $PORT --hostname 127.0.0.1',
  nuxt: '--port $PORT --host 127.0.0.1'
}

/** `npm run dev`, `pnpm dev`, `pnpm run dev`, `yarn dev`, `yarn run dev`, `bun run dev`. */
const SCRIPT_RUN = /^(npm run|pnpm(?: run)?|yarn(?: run)?|bun run)\s+([\w:.-]+)$/

function readScripts(dir: string): Record<string, string> | null {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, string> }
    return parsed.scripts ?? null
  } catch {
    return null
  }
}

/** Which framework a single script body runs, or null when it is anything else. */
export function frameworkOf(script: string): Framework | null {
  const body = script.trim()
  // Compound or wrapped scripts are out of scope: flags would land on the wrong tool.
  if (/[;&|]|\bconcurrently\b|\bnpm-run-all\b|\brun-p\b|\bturbo\b|\bnx\b/.test(body)) return null
  // A script that already picks its port has made its choice.
  if (/--port\b|(?:^|\s)-p(?:\s|=)|\bPORT=/.test(body)) return null
  if (/^vite(?:\s+(?:dev|serve))?(?:\s|$)/.test(body)) return 'vite'
  if (/^astro\s+dev(?:\s|$)/.test(body)) return 'astro'
  if (/^next\s+dev(?:\s|$)/.test(body)) return 'next'
  if (/^(?:nuxt|nuxi)\s+dev(?:\s|$)/.test(body)) return 'nuxt'
  return null
}

/**
 * The command devLaunchr will actually run for this project, with framework
 * port flags added where it is safe to do so. The stored start command is never
 * changed; this is computed fresh at every start.
 */
export function effectiveCommand(project: Pick<Project, 'path' | 'startCommand'>): string {
  const command = project.startCommand.trim()
  const run = SCRIPT_RUN.exec(command)
  if (!run) return command
  if (/\$\{?PORT\}?|--port\b|(?:^|\s)-p(?:\s|=)/.test(command)) return command

  const script = readScripts(project.path)?.[run[2]!]
  if (!script) return command
  const framework = frameworkOf(script)
  if (!framework) return command

  // npm needs `--` to forward flags to the script; the others forward them as-is.
  const separator = run[1] === 'npm run' ? ' -- ' : ' '
  return `${command}${separator}${FLAGS[framework]}`
}

/**
 * Replaces $PORT / ${PORT} with the number itself.
 *
 * On Windows the command runs under PowerShell, where `$PORT` is an unset
 * PowerShell variable rather than the environment variable, so it silently
 * became an empty string. Substituting the value makes every shell agree.
 */
export function substitutePort(command: string, port: number): string {
  return command.replace(/\$\{PORT\}|\$PORT\b/g, String(port))
}

/**
 * A port the project will use no matter what devLaunchr assigns, and where it
 * is written. `npm run dev` says nothing about ports, but the script it runs
 * (`node serve.mjs --port 3000`) may, and that port is just as fixed.
 */
export function pinnedPortOf(
  project: Pick<Project, 'path' | 'startCommand'>
): { port: number; source: 'command' } | { port: number; source: 'script'; script: string } | null {
  const command = effectiveCommand(project)
  const direct = portFromCommand(command)
  if (direct.honorsEnv) return null
  if (direct.port !== null) return { port: direct.port, source: 'command' }

  const run = SCRIPT_RUN.exec(project.startCommand.trim())
  const name = run?.[2]
  const script = name ? readScripts(project.path)?.[name] : undefined
  if (!name || !script) return null
  const inScript = portFromCommand(script)
  return !inScript.honorsEnv && inScript.port !== null ? { port: inScript.port, source: 'script', script: name } : null
}
