import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type {
  ExternalOwner, LogLine, PortConflict, Project, ProjectStatus, RuntimeState, Settings
} from '@shared/types'
import type { Diagnosis } from '@shared/ipc'
import { LineSplitter, LogBuffer } from './logBuffer'
import { parsePort, waitForHealthy } from './healthCheck'
import { cachedPath, resolveLoginPath } from './pathResolver'
import * as ports from './portRegistry'
import * as ledger from './ledger'
import { startStaticServer, type StaticHandle } from './staticServer'
import { inspectDependencies, portFromCommand } from './dependencies'
import { missingRequirements } from './requirements'
import { clearToolCache } from './toolchain'
import {
  isProcessAlive, killProcessTree, processGroupOf, shellFor, SUPPORTS_PROCESS_GROUPS
} from './platform'
import { diagnose, isDesktopApp } from './diagnostics'
import { findExternalServers } from './adoption'
import { listListeners } from './ports'

const SIGKILL_GRACE_MS = 5000
const LOG_FLUSH_MS = 60

interface Runtime {
  projectId: string
  status: ProjectStatus
  pid: number | null
  port: number | null
  url: string | null
  startedAt: number | null
  lastError: string | null
  logs: LogBuffer
  child: ChildProcess | null
  staticHandle: StaticHandle | null
  health: { cancelled: boolean }
  stopping: boolean
  needsInstall: boolean
  conflict: PortConflict | null
  diagnosis: Diagnosis | null
  external: ExternalOwner | null
  /** Guards the one automatic retry after a port collision. */
  retriedPort: boolean
}

export interface LogBatch {
  projectId: string
  lines: LogLine[]
}

const runtimes = new Map<string, Runtime>()
export const events = new EventEmitter()

// ------------------------------------------------------------------ plumbing

function runtimeFor(projectId: string): Runtime {
  let runtime = runtimes.get(projectId)
  if (!runtime) {
    runtime = {
      projectId,
      status: 'stopped',
      pid: null,
      port: null,
      url: null,
      startedAt: null,
      lastError: null,
      logs: new LogBuffer(),
      child: null,
      staticHandle: null,
      health: { cancelled: false },
      stopping: false,
      needsInstall: false,
      conflict: null,
      diagnosis: null,
      external: null,
      retriedPort: false
    }
    runtimes.set(projectId, runtime)
  }
  return runtime
}

const snapshot = (runtime: Runtime): RuntimeState => ({
  projectId: runtime.projectId,
  status: runtime.status,
  pid: runtime.pid,
  port: runtime.port,
  url: runtime.url,
  startedAt: runtime.startedAt,
  lastError: runtime.lastError,
  needsInstall: runtime.needsInstall,
  conflict: runtime.conflict,
  diagnosis: runtime.diagnosis,
  external: runtime.external
})

function emitState(runtime: Runtime): void {
  events.emit('state', snapshot(runtime))
}

const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]|${String.fromCharCode(27)}\\][^${String.fromCharCode(7)}]*${String.fromCharCode(7)}`,
  'g'
)

const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '')

/**
 * Log lines are batched before crossing IPC. A Next.js or webpack dev server
 * can emit thousands of lines a second during a cold build, and one IPC
 * message per line saturates the renderer long before the content matters.
 */
const pending = new Map<string, LogLine[]>()
let flushTimer: NodeJS.Timeout | null = null

function queueLog(runtime: Runtime, stream: LogLine['stream'], text: string): void {
  const line = runtime.logs.push(stream, stripAnsi(text))
  const batch = pending.get(runtime.projectId) ?? []
  batch.push(line)
  pending.set(runtime.projectId, batch)

  flushTimer ??= setTimeout(() => {
    flushTimer = null
    for (const [projectId, lines] of pending) {
      events.emit('logs', { projectId, lines } satisfies LogBatch)
    }
    pending.clear()
  }, LOG_FLUSH_MS)
}

// --------------------------------------------------------------------- state

export const getState = (projectId: string): RuntimeState => snapshot(runtimeFor(projectId))

/**
 * The PATH projects are launched with.
 *
 * Requirement checks must look at the same PATH a project would actually run
 * with, or a tool installed via Homebrew reads as missing in a GUI-launched
 * app whose own PATH is minimal.
 */
export const cachedEnvPath = (): string | undefined => cachedPath() ?? undefined

/** Every project currently believed to be serving, with its live URL. */
export const runningWithUrls = (): Array<{ projectId: string; url: string }> =>
  [...runtimes.values()]
    .filter((runtime) => runtime.status === 'running' && runtime.url !== null)
    .map((runtime) => ({ projectId: runtime.projectId, url: runtime.url as string }))

export const allStates = (): RuntimeState[] => [...runtimes.values()].map(snapshot)

/** Fetched once when a log pane opens; afterwards it follows the batches. */
export const getLogs = (projectId: string): LogLine[] => runtimeFor(projectId).logs.all()

export function clearLogs(projectId: string): void {
  const runtime = runtimeFor(projectId)
  runtime.logs.clear()
  emitState(runtime)
}

export const isRunning = (projectId: string): boolean => {
  const status = runtimes.get(projectId)?.status
  return status === 'running' || status === 'starting'
}

/** True when devLaunchr itself owns the process, as opposed to having adopted it. */
const isOurs = (projectId: string): boolean => {
  const runtime = runtimes.get(projectId)
  if (!runtime) return false
  if (runtime.external !== null) return false
  return runtime.child !== null || runtime.staticHandle !== null || isRunning(projectId)
}

/**
 * Reconciles devLaunchr's picture of the world with what is actually listening
 * on this machine.
 *
 * Projects already serving from a terminal or an IDE are adopted: shown as
 * running, with their real port and URL, so the preview opens the right site
 * and Start does not spawn a duplicate that immediately collides. Adopted
 * projects whose process has since gone are released.
 */
export async function detectExternal(projects: Project[]): Promise<number> {
  const servers = await findExternalServers(projects, isOurs)
  const byProject = new Map(servers.map((server) => [server.projectId, server]))

  // Drop adoptions that are no longer true.
  for (const runtime of runtimes.values()) {
    if (runtime.external === null) continue
    if (byProject.has(runtime.projectId)) continue

    runtime.external = null
    runtime.status = 'stopped'
    runtime.port = null
    runtime.url = null
    runtime.pid = null
    ports.release(runtime.projectId)
    queueLog(runtime, 'system', 'The externally started server is no longer running')
    emitState(runtime)
  }

  for (const server of servers) {
    const runtime = runtimeFor(server.projectId)
    if (isOurs(server.projectId)) continue

    const unchanged =
      runtime.external?.pid === server.pid && runtime.port === server.port
    if (unchanged) continue

    runtime.external = {
      pid: server.pid,
      command: server.command,
      matchedBy: server.matchedBy
    }
    runtime.status = 'running'
    runtime.port = server.port
    runtime.url = server.url
    runtime.pid = server.pid
    runtime.lastError = null
    runtime.diagnosis = null
    runtime.conflict = null
    ports.claim(server.projectId, server.port, null)

    queueLog(
      runtime,
      'system',
      `Already running outside devLaunchr on port ${server.port} (${server.command}, pid ${server.pid})`
    )
    emitState(runtime)
  }

  return servers.length
}

// ------------------------------------------------------------ dependencies

/**
 * A freshly cloned project has no installed dependencies, so its dev binary
 * does not exist and the shell exits 127 — "command not found". Detecting that
 * up front turns an opaque exit code into one action.
 */
export function dependenciesMissing(project: Project): boolean {
  return inspectDependencies(project).missing
}

/** Exit 127 from a shell means the command itself was not found. */
const looksLikeMissingBinary = (code: number | null, logs: string): boolean =>
  code === 127 || /command not found|: not found\b/i.test(logs)

/** Pulls the port out of an EADDRINUSE report, whatever shape it took. */
function portAlreadyInUse(logs: string): number | null {
  if (!/EADDRINUSE|address already in use|port .*(is )?(already )?in use/i.test(logs)) return null

  const patterns = [
    /port:\s*(\d{2,5})/i,
    /address already in use[^\d]*(?::|\s)(\d{2,5})\b/i,
    /port (\d{2,5}) is (?:already )?in use/i,
    /EADDRINUSE[^\d]*(\d{2,5})\b/i
  ]
  for (const pattern of patterns) {
    const value = pattern.exec(logs)?.[1]
    if (!value) continue
    const port = Number.parseInt(value, 10)
    if (port >= 1 && port <= 65535) return port
  }
  return null
}

/** Who is holding a port, so the error can name it instead of guessing. */
async function findHolder(port: number): Promise<{ pid: number; command: string } | null> {
  try {
    const listeners = await listListeners()
    const match = listeners.find((entry) => entry.port === port)
    return match ? { pid: match.pid, command: match.command } : null
  } catch {
    return null
  }
}

export async function install(project: Project): Promise<boolean> {
  const runtime = runtimeFor(project.id)
  if (runtime.status === 'installing' || runtime.status === 'running') return false

  // The project's own command wins; otherwise the ecosystem decides. A repo
  // cloned without an install command set should still be installable.
  const plan = inspectDependencies(project)
  const command = project.installCommand?.trim() || plan.command
  if (!command) {
    fail(runtime, 'There is nothing to install for this project.')
    return false
  }

  runtime.status = 'installing'
  runtime.lastError = null
  emitState(runtime)

  const path = await resolveLoginPath()
  queueLog(runtime, 'system', `$ ${command}`)

  const succeeded = await new Promise<boolean>((resolve) => {
    const shell = shellFor(command)
    const child = spawn(shell.file, shell.args, {
      cwd: project.path,
      env: { ...process.env, PATH: path, NO_COLOR: '1', FORCE_COLOR: '0' },
      detached: SUPPORTS_PROCESS_GROUPS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    runtime.child = child
    runtime.pid = child.pid ?? null
    emitState(runtime)

    pipe(runtime, child, 'stdout')
    pipe(runtime, child, 'stderr')

    child.on('error', (error) => {
      queueLog(runtime, 'system', `spawn error: ${error.message}`)
      resolve(false)
    })
    child.on('exit', (code) => {
      runtime.child = null
      runtime.pid = null
      resolve(code === 0)
    })
  })

  runtime.needsInstall = dependenciesMissing(project)

  if (succeeded) {
    runtime.status = 'stopped'
    runtime.diagnosis = null
    queueLog(runtime, 'system', 'Dependencies installed')
    emitState(runtime)
    return true
  }

  fail(runtime, 'Installing dependencies failed. The log above has the details.')
  return false
}

/**
 * Runs a one-off repair command a diagnosis proposed, streaming it into the
 * same log pane. Kept separate from install() because the command comes from
 * the diagnosis table rather than the project's configuration.
 */
export async function runFix(project: Project, command: string): Promise<boolean> {
  const runtime = runtimeFor(project.id)
  if (runtime.status === 'installing' || runtime.status === 'running') return false

  runtime.status = 'installing'
  runtime.lastError = null
  emitState(runtime)

  const path = await resolveLoginPath()
  queueLog(runtime, 'system', `$ ${command}`)

  const succeeded = await new Promise<boolean>((resolve) => {
    const shell = shellFor(command)
    const child = spawn(shell.file, shell.args, {
      cwd: project.path,
      env: { ...process.env, PATH: path, NO_COLOR: '1', FORCE_COLOR: '0' },
      detached: SUPPORTS_PROCESS_GROUPS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    runtime.child = child
    runtime.pid = child.pid ?? null
    emitState(runtime)

    pipe(runtime, child, 'stdout')
    pipe(runtime, child, 'stderr')

    child.on('error', () => resolve(false))
    child.on('exit', (code) => {
      runtime.child = null
      runtime.pid = null
      resolve(code === 0)
    })
  })

  if (succeeded) {
    // Whatever was just installed should be visible to the next check.
    clearToolCache()
    runtime.status = 'stopped'
    runtime.diagnosis = null
    queueLog(runtime, 'system', 'Done')
    emitState(runtime)
    return true
  }

  fail(runtime, 'That fix did not succeed. The log above has the details.')
  return false
}

// --------------------------------------------------------------------- start

export async function init(): Promise<ledger.ReapReport> {
  const report = await ledger.reapOrphans()
  void resolveLoginPath()
  return report
}

export async function start(
  project: Project,
  settings: Settings,
  options: { isRetry?: boolean } = {}
): Promise<void> {
  const runtime = runtimeFor(project.id)
  if (runtime.status === 'starting' || runtime.status === 'running') return

  // Somebody may have started this in a terminal since the last look. Starting
  // a second copy would collide on the port at best, and at worst leave the
  // preview pointing at whichever server won.
  if (!options.isRetry) {
    await detectExternal([project])
    if (runtime.external !== null) {
      queueLog(runtime, 'system', 'Already running; devLaunchr attached to it instead of starting a second copy')
      return
    }
  }

  // A user-initiated start is always allowed one automatic port retry; only
  // the retry itself must not retry again.
  if (!options.isRetry) runtime.retriedPort = false

  // A tool the project needs but the machine does not have cannot be fixed by
  // installing project dependencies, so it is reported before anything runs
  // rather than as an exit code afterwards.
  const missingTools = missingRequirements(project, cachedPath() ?? undefined)
  if (missingTools.length > 0) {
    const first = missingTools[0]
    if (first) {
      runtime.status = 'crashed'
      runtime.lastError = `${first.label} is not installed`
      runtime.diagnosis = {
        title:
          missingTools.length === 1
            ? `${first.label} is not installed`
            : `${missingTools.length} required tools are not installed`,
        detail: missingTools
          .map((tool) => `${tool.label}: ${tool.reason}`)
          .join(' '),
        actions: [
          ...(first.installCommand
            ? [{ kind: 'run' as const, label: `Install ${first.label}`, command: first.installCommand }]
            : []),
          ...(first.docs
            ? [{ kind: 'docs' as const, label: `${first.label} install guide`, url: first.docs }]
            : [])
        ]
      }
      queueLog(runtime, 'system', runtime.lastError)
      emitState(runtime)
      return
    }
  }

  // Checked before anything is spawned: starting a project whose dependencies
  // are missing only produces a confusing exit code.
  const plan = inspectDependencies(project)
  if (plan.missing) {
    if (!settings.autoInstall || !(project.installCommand?.trim() || plan.command)) {
      runtime.needsInstall = true
      runtime.status = 'crashed'
      runtime.lastError = plan.reason || 'Dependencies are not installed.'
      queueLog(runtime, 'system', runtime.lastError)
      emitState(runtime)
      return
    }

    queueLog(runtime, 'system', plan.reason)
    queueLog(runtime, 'system', 'Installing dependencies before starting…')
    const installed = await install(project)
    if (!installed) return // install() has already reported the failure
  }

  runtime.needsInstall = false
  runtime.conflict = null
  runtime.diagnosis = null
  runtime.status = 'starting'
  runtime.lastError = null
  runtime.startedAt = Date.now()
  runtime.stopping = false
  runtime.health = { cancelled: false }
  emitState(runtime)

  let port: number
  try {
    port = await ports.allocate(
      project.id,
      project.preferredPort,
      settings.portRangeStart,
      settings.portRangeEnd
    )
  } catch (error) {
    fail(runtime, error instanceof Error ? error.message : String(error))
    return
  }

  runtime.port = port
  emitState(runtime)

  if (project.type === 'static') {
    await startStatic(runtime, project, port)
    return
  }

  if (!project.startCommand.trim()) {
    fail(runtime, 'No start command is set for this project.')
    return
  }

  await startProcess(runtime, project, settings, port)
}

async function startStatic(runtime: Runtime, project: Project, port: number): Promise<void> {
  queueLog(runtime, 'system', `Serving ${project.path} with the built-in static server`)
  try {
    runtime.staticHandle = await startStaticServer(project.path, port)
    runtime.status = 'running'
    runtime.url = `http://127.0.0.1:${port}/`
    queueLog(runtime, 'system', `Ready at ${runtime.url}`)
    emitState(runtime)
  } catch (error) {
    fail(runtime, error instanceof Error ? error.message : String(error))
  }
}

async function startProcess(
  runtime: Runtime,
  project: Project,
  settings: Settings,
  port: number
): Promise<void> {
  const path = await resolveLoginPath()

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: path,
    PORT: String(port),
    // Dev servers love to hijack the user's browser; the whole point of this
    // app is that the site opens in its own tab.
    BROWSER: 'none',
    // Logs render as plain text, so colour codes are pure noise.
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    ...project.env
  }

  queueLog(runtime, 'system', `$ ${project.startCommand}`)
  queueLog(runtime, 'system', `cwd: ${project.path} · PORT=${port}`)

  let child: ChildProcess
  try {
    const shell = shellFor(project.startCommand)
    child = spawn(shell.file, shell.args, {
      cwd: project.path,
      env,
      // On Unix, detached makes the child a process-group leader, which is
      // what lets kill(-pid) take down the whole tree: a dev server's own
      // children -- esbuild, tsc, the framework's worker pool -- survive
      // anything else and keep holding the port. Windows has no equivalent,
      // so the tree is walked with taskkill /T instead.
      detached: SUPPORTS_PROCESS_GROUPS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    fail(runtime, error instanceof Error ? error.message : String(error))
    return
  }

  if (!child.pid) {
    fail(runtime, 'The process could not be started.')
    return
  }

  runtime.child = child
  runtime.pid = child.pid
  emitState(runtime)

  ledger.record({
    projectId: project.id,
    name: project.name,
    pid: child.pid,
    port,
    command: project.startCommand,
    cwd: project.path,
    startedAt: runtime.startedAt ?? Date.now(),
    psStart: ledger.processStartTime(child.pid)
  })

  pipe(runtime, child, 'stdout')
  pipe(runtime, child, 'stderr')

  child.on('error', (error) => {
    queueLog(runtime, 'system', `spawn error: ${error.message}`)
  })

  child.on('exit', (code, signal) => {
    ledger.forget(child.pid ?? -1)
    runtime.child = null
    runtime.pid = null

    if (runtime.stopping) return // stop() owns the transition

    runtime.health.cancelled = true
    const detail = signal ? `signal ${signal}` : `exit code ${code}`
    queueLog(runtime, 'system', `Process ended (${detail})`)

    const recent = runtime.logs.all().slice(-60).map((line) => line.text).join('\n')

    // A port collision has its own handling: it can sometimes be retried, and
    // the useful detail lives outside this process.
    const busyPort = portAlreadyInUse(recent)
    if (busyPort !== null) {
      void reportPortConflict(runtime, project, busyPort, settings)
      return
    }

    // Everything else goes through the diagnosis table, which turns an exit
    // code into a cause and a next step wherever it recognises one.
    const diagnosis = diagnose({ project, exitCode: code, signal, logs: recent })
    runtime.needsInstall = inspectDependencies(project).missing

    if (diagnosis) {
      fail(runtime, diagnosis.title, diagnosis)
      return
    }

    if (looksLikeMissingBinary(code, recent)) {
      fail(runtime, 'The start command was not found. Check that it is spelled correctly and installed.')
      return
    }

    fail(runtime, `The server stopped on its own (${detail}).`)
  })

  // An Electron or Tauri project opens its own window instead of serving a
  // page. Waiting for an HTTP response would time out and report a crash for
  // an app that started perfectly well, so a desktop project counts as running
  // once it has survived long enough to prove it did not fail immediately.
  if (isDesktopApp(project)) {
    queueLog(runtime, 'system', 'Desktop app: skipping the HTTP health check')
    await new Promise((resolve) => setTimeout(resolve, 2500))
    if (runtime.stopping || runtime.health.cancelled || runtime.child === null) return
    runtime.status = 'running'
    runtime.url = null
    queueLog(runtime, 'system', 'Running')
    emitState(runtime)
    return
  }

  const result = await waitForHealthy({
    getPort: () => runtime.port ?? port,
    timeoutMs: settings.healthCheckTimeoutMs,
    isAlive: () => runtime.child !== null,
    signal: runtime.health
  })

  if (result.reason === 'cancelled' || runtime.stopping) return
  if (!result.ok) {
    // An exit was already reported by the exit handler; do not double-report.
    if (result.reason === 'exited') return
    fail(
      runtime,
      `No response on port ${runtime.port} after ${Math.round(settings.healthCheckTimeoutMs / 1000)}s.`
    )
    return
  }

  // Something answered on that port — but prove it is ours before showing it
  // as this project's preview. Our children are spawned as process-group
  // leaders, so a listener that belongs to us reports our child's pid as its
  // process group.
  const owned = await portBelongsToUs(runtime.port ?? port, child.pid)
  if (!owned) {
    queueLog(
      runtime,
      'system',
      `Port ${runtime.port} is answering, but the process holding it is not this project`
    )
    await reportPortConflict(runtime, project, runtime.port ?? port, settings)
    return
  }

  const host = result.host === '::1' ? '[::1]' : (result.host ?? '127.0.0.1')
  runtime.status = 'running'
  runtime.url = `http://${host}:${runtime.port}/`
  queueLog(runtime, 'system', `Ready at ${runtime.url}`)
  emitState(runtime)
}

/**
 * Whether the process listening on a port belongs to the group we started.
 *
 * Returns true when it cannot tell — on Windows there are no process groups,
 * and refusing to start on an inconclusive check would be worse than trusting
 * it.
 */
async function portBelongsToUs(port: number, childPid: number | undefined): Promise<boolean> {
  if (!SUPPORTS_PROCESS_GROUPS || !childPid) return true

  try {
    const listeners = await listListeners()
    const holders = listeners.filter((entry) => entry.port === port)
    if (holders.length === 0) return true // nothing to contradict us

    return holders.some(
      (entry) => entry.pid === childPid || processGroupOf(entry.pid) === childPid
    )
  } catch {
    return true
  }
}

/** Announced ports currently being verified, so one log line is checked once. */
const pendingPortChecks = new Set<string>()

/**
 * Accepts a port the child announced, but only after confirming the child
 * actually owns it.
 *
 * A dev server printing `Local: http://localhost:3000` is a claim, not a fact:
 * the port may already belong to something else that devLaunchr never started.
 * Believing the claim is what makes one project's preview show another
 * project's site.
 */
async function considerAnnouncedPort(runtime: Runtime, announced: number): Promise<void> {
  const key = `${runtime.projectId}:${announced}`
  if (pendingPortChecks.has(key)) return
  pendingPortChecks.add(key)

  try {
    // Give the child a moment to bind before asking who holds the port.
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (runtime.stopping || runtime.child === null) return

    const childPid = runtime.child.pid
    const mine = await portBelongsToUs(announced, childPid)
    if (!mine) {
      const holder = await findHolder(announced)
      queueLog(
        runtime,
        'system',
        `This project announced port ${announced}, but ${
          holder ? `${holder.command} (pid ${holder.pid})` : 'another process'
        } holds it — not following it`
      )
      return
    }

    if (runtime.port === announced) return
    queueLog(
      runtime,
      'system',
      `Server announced port ${announced}; following it instead of ${runtime.port}`
    )
    ports.claim(runtime.projectId, announced, runtime.port)
    runtime.port = announced
    emitState(runtime)
  } finally {
    pendingPortChecks.delete(key)
  }
}

function pipe(runtime: Runtime, child: ChildProcess, stream: 'stdout' | 'stderr'): void {
  const source = child[stream]
  if (!source) return

  const splitter = new LineSplitter()
  source.setEncoding('utf8')
  source.on('data', (chunk: string) => {
    for (const line of splitter.push(chunk)) {
      queueLog(runtime, stream, line)

      // Frameworks routinely ignore $PORT; whatever they print is usually the
      // truth. "Usually", because a tool that failed to bind can still print
      // its default port, and believing it would make two projects claim the
      // same port and show each other's site in the preview.
      if (runtime.status !== 'starting') continue
      const announced = parsePort(line)
      if (announced === null || announced === runtime.port) continue

      const owner = ports.ownerOf(announced)
      if (owner && owner !== runtime.projectId && isRunning(owner)) {
        queueLog(
          runtime,
          'system',
          `Ignoring announced port ${announced}: another running project already holds it`
        )
        continue
      }

      // Verified against the system, not just against our own bookkeeping.
      // A tool can print a port it never managed to bind — Vite announces its
      // configured port before it knows whether it got it — and following that
      // blindly points the preview at whoever actually holds it.
      void considerAnnouncedPort(runtime, announced)
    }
  })
  source.on('end', () => {
    for (const line of splitter.flush()) queueLog(runtime, stream, line)
  })
}

/**
 * A port collision is the one failure where the useful information lives
 * outside this app: which process is holding the port, and whether the project
 * even honours the port we assigned it.
 */
async function reportPortConflict(
  runtime: Runtime,
  project: Project,
  port: number,
  settings: Settings
): Promise<void> {
  const holder = await findHolder(port)
  const { honorsEnv } = portFromCommand(project.startCommand)
  const assigned = runtime.port

  // If the project uses the port we gave it, the collision is a race we can
  // simply retry on a different port. If it pinned its own, retrying is
  // pointless — it would pick the same one again.
  const hardcoded = !honorsEnv && assigned !== null && port !== assigned

  if (!hardcoded && !runtime.retriedPort) {
    runtime.retriedPort = true
    queueLog(runtime, 'system', `Port ${port} was taken; retrying on a different port`)
    ports.release(project.id)
    runtime.status = 'stopped'
    await start(project, settings, { isRetry: true })
    return
  }

  runtime.conflict = {
    port,
    pid: holder?.pid ?? null,
    command: holder?.command ?? null,
    hardcoded
  }

  const owner = holder ? `${holder.command} (pid ${holder.pid})` : 'another process'
  fail(
    runtime,
    hardcoded
      ? `This project asks for port ${port}, which ${owner} is already using. devLaunchr did not start that process.`
      : `Port ${port} is already in use by ${owner}.`
  )
}

function fail(runtime: Runtime, error: string, diagnosis: Diagnosis | null = null): void {
  runtime.health.cancelled = true
  runtime.status = 'crashed'
  runtime.lastError = error
  runtime.url = null
  // The port goes too. A crashed project that keeps displaying a port it no
  // longer holds is how two projects end up showing the same one.
  runtime.port = null
  runtime.diagnosis = diagnosis
  ports.release(runtime.projectId)
  queueLog(runtime, 'system', error)
  emitState(runtime)
}

// ---------------------------------------------------------------------- stop

export async function stop(project: Project): Promise<void> {
  const runtime = runtimeFor(project.id)
  if (runtime.status === 'stopped' || runtime.status === 'stopping') return

  // An adopted server belongs to whoever started it. Quitting it is a
  // deliberate act the UI confirms separately, so Stop only detaches.
  if (runtime.external !== null) {
    queueLog(runtime, 'system', 'Detached. The server is still running outside devLaunchr.')
    runtime.external = null
    runtime.status = 'stopped'
    runtime.port = null
    runtime.url = null
    runtime.pid = null
    ports.release(project.id)
    emitState(runtime)
    return
  }

  runtime.stopping = true
  runtime.health.cancelled = true
  runtime.status = 'stopping'
  emitState(runtime)

  if (runtime.staticHandle) {
    await runtime.staticHandle.close()
    runtime.staticHandle = null
  }

  if (project.type === 'docker-compose') {
    await composeDown(runtime, project)
  }

  const child = runtime.child
  if (child?.pid) {
    await killGroup(runtime, child.pid)
  }

  ports.release(project.id)
  ledger.forget(runtime.pid ?? -1)

  runtime.child = null
  runtime.pid = null
  runtime.port = null
  runtime.url = null
  runtime.startedAt = null
  runtime.status = 'stopped'
  runtime.stopping = false
  queueLog(runtime, 'system', 'Stopped')
  emitState(runtime)
}

/**
 * The negative pid is the entire point: it signals the process *group*, so the
 * dev server's children die with it. Signalling the pid alone leaves orphans
 * that keep the port bound and make the next start pick a different one.
 */
async function killGroup(runtime: Runtime, pid: number): Promise<void> {
  // Anything at or below pid 1 is refused by killProcessTree: on Unix,
  // kill(-0) would signal devLaunchr's own process group.
  if (!Number.isInteger(pid) || pid <= 1) return

  killProcessTree(pid, false)

  const deadline = Date.now() + SIGKILL_GRACE_MS
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  queueLog(runtime, 'system', `Did not exit in ${SIGKILL_GRACE_MS / 1000}s - forcing it`)
  killProcessTree(pid, true)
}

function composeDown(runtime: Runtime, project: Project): Promise<void> {
  return new Promise((resolve) => {
    queueLog(runtime, 'system', '$ docker compose down')
    resolveLoginPath()
      .then((path) => {
        const down = shellFor('docker compose down')
        const child = spawn(down.file, down.args, {
          cwd: project.path,
          env: { ...process.env, PATH: path },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        const splitter = new LineSplitter()
        child.stdout?.setEncoding('utf8')
        child.stderr?.setEncoding('utf8')
        const onData = (chunk: string): void => {
          for (const line of splitter.push(chunk)) queueLog(runtime, 'system', line)
        }
        child.stdout?.on('data', onData)
        child.stderr?.on('data', onData)

        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 30_000)

        child.on('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        child.on('error', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      .catch(() => resolve())
  })
}

export async function restart(project: Project, settings: Settings): Promise<void> {
  await stop(project)
  await start(project, settings)
}

/**
 * Called from `before-quit`. Runs in parallel -- stopping three projects one at
 * a time could burn fifteen seconds of SIGKILL grace, and macOS force-kills the
 * app after about five on logout.
 */
export async function stopAll(projects: Project[]): Promise<void> {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const live = [...runtimes.values()].filter(
    (runtime) => runtime.status !== 'stopped' && runtime.status !== 'crashed'
  )

  await Promise.all(
    live.map(async (runtime) => {
      const project = byId.get(runtime.projectId)
      if (project) return stop(project)
      // The project was deleted while running; kill by pid anyway.
      if (runtime.pid) await killGroup(runtime, runtime.pid)
    })
  )

  ledger.clear()
}
