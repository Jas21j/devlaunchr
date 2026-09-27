import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { Project } from '@shared/types'
import type { Listener } from './ports'
import { portFromCommand } from './dependencies'
import { belongsTo, commandLines, listeners as readListeners, processTable, workingDirectories } from './processTable'
import { previewHost } from './ownership'

/**
 * A server that is already running, started by something other than
 * devLaunchr — a terminal, an IDE, a previous session of another tool.
 */
export interface ExternalServer {
  projectId: string
  port: number
  pid: number
  command: string
  url: string
  /** How the process was matched to the project, strongest first. */
  matchedBy: 'cwd' | 'commandLine' | 'pinnedPort'
}

/**
 * Resolves a path through symlinks before comparing.
 *
 * A process's reported working directory and a project's stored path can be
 * the same folder spelled two different ways — macOS resolves /tmp and /var
 * to /private/..., and people symlink project folders all the time. Comparing
 * the unresolved strings silently fails to match.
 */
const canonical = (path: string): string => {
  const normalized = resolve(path).replace(/[/\\]+$/, '')
  try {
    return realpathSync.native(normalized).replace(/[/\\]+$/, '')
  } catch {
    // The path may not exist any more; the normalized form is still useful.
    return normalized
  }
}

/** True when `child` is the same folder as `parent`, or lives inside it. */
function isWithin(child: string, parent: string): boolean {
  const a = canonical(child)
  const b = canonical(parent)
  return a === b || a.startsWith(b + sep)
}

/**
 * Whether a command line names a project folder. The folder can appear in more
 * than one spelling: resolved through symlinks, as typed, or on Windows as an
 * 8.3 short path (C:\Users\RUNNER~1) in either case.
 */
function mentions(commandLine: string, path: string): boolean {
  const fold = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value)
  const haystack = fold(commandLine)
  return [canonical(path), resolve(path).replace(/[/\\]+$/, '')].some((form) => haystack.includes(fold(form)))
}

/**
 * Finds projects that are already serving, without devLaunchr having started
 * them.
 *
 * Without this, a project you started in a terminal looks stopped here, and
 * starting it again either fails on a port collision or — worse — devLaunchr
 * shows some other project's site in its preview because the ports no longer
 * line up with reality.
 *
 * Matching is by evidence, strongest first:
 *
 *   1. The listening process's working directory is the project folder. A dev
 *      server always runs in its own project, so this is near-certain.
 *   2. The project's path appears in the process's command line. Covers
 *      Windows, where a process's cwd is not cheaply readable, and wrappers
 *      that change directory before exec.
 *   3. The project pins a port in its own start command and that port is
 *      listening. Weakest, and only used when nothing else claimed it.
 */
export async function findExternalServers(
  projects: Project[],
  isManagedByUs: (projectId: string) => boolean
): Promise<ExternalServer[]> {
  if (projects.length === 0) return []

  const candidates = projects.filter((project) => !isManagedByUs(project.id))
  if (candidates.length === 0) return []

  const listeners = await readListeners()
  if (listeners.length === 0) return []

  const found = new Map<string, ExternalServer>()
  const claimedPorts = new Set<number>()

  const record = (
    project: Project,
    listener: { port: number; pid: number; command: string },
    matchedBy: ExternalServer['matchedBy']
  ): void => {
    if (found.has(project.id) || claimedPorts.has(listener.port)) return
    const socket = byPort.get(listener.port)!
    found.set(project.id, {
      projectId: project.id,
      port: listener.port,
      pid: listener.pid,
      command: listener.command,
      url: `http://${previewHost(socket.address)}:${listener.port}/`,
      matchedBy
    })
    claimedPorts.add(listener.port)
  }

  // Only ports that could plausibly be a dev server are inspected. Everything
  // below 1024 is a system service, and the high ephemeral range is outbound
  // traffic.
  const inRange = listeners.filter((entry) => entry.port >= 1024 && entry.port < 49152)

  // One socket per port, and never a port two unrelated processes share: its
  // preview would show whichever bound the more specific address, which may
  // not be the project it is attributed to.
  const table = await processTable()
  const byPort = new Map<number, Listener>()
  const shared = new Set<number>()
  for (const entry of inRange) {
    const first = byPort.get(entry.port)
    if (!first) {
      byPort.set(entry.port, entry)
      continue
    }
    if (entry.pid !== first.pid && !belongsTo(entry.pid, first.pid, table) && !belongsTo(first.pid, entry.pid, table)) {
      shared.add(entry.port)
    }
    // Prefer the explicit IPv4 loopback socket; that is what a browser reaches.
    if (entry.address === '127.0.0.1') byPort.set(entry.port, entry)
  }
  const plausible = [...byPort.values()].filter((entry) => !shared.has(entry.port))

  // Every cwd and command line in two subprocesses, not two per listener.
  const pids = plausible.map((entry) => entry.pid)
  const [cwds, commands] = await Promise.all([workingDirectories(pids), commandLines(pids)])

  // --- 1. working directory
  for (const listener of plausible) {
    if (claimedPorts.has(listener.port)) continue
    const cwd = cwds.get(listener.pid)
    if (!cwd) continue

    // Deepest project first, so a monorepo's app matches before its root.
    const match = candidates
      .filter((project) => isWithin(cwd, project.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (match) record(match, listener, 'cwd')
  }

  // --- 2. command line
  for (const listener of plausible) {
    if (claimedPorts.has(listener.port)) continue
    const commandLine = commands.get(listener.pid)
    if (!commandLine) continue

    const match = candidates
      .filter((project) => !found.has(project.id) && mentions(commandLine, project.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (match) record(match, listener, 'commandLine')
  }

  // --- 3. a port the project pins for itself
  //
  // Only a port written into the project's own start command counts. An
  // assigned `preferredPort` is devLaunchr's bookkeeping, not evidence about
  // who is listening — using it would adopt whatever happened to hold that
  // number and attribute a stranger's server to this project.
  for (const project of candidates) {
    if (found.has(project.id)) continue

    const pinned = portFromCommand(project.startCommand)
    if (pinned.honorsEnv || pinned.port === null) continue
    if (claimedPorts.has(pinned.port)) continue

    const listener = plausible.find((entry) => entry.port === pinned.port)
    if (!listener) continue

    // If the working directory is readable and belongs somewhere else, the
    // port match is a coincidence. Only trust the port when cwd is unknown,
    // which is the Windows case.
    const cwd = cwds.get(listener.pid)
    if (cwd && !isWithin(cwd, project.path)) continue

    record(project, listener, 'pinnedPort')
  }

  return [...found.values()]
}
