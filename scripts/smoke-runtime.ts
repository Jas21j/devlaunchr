/**
 * Exercises the process manager against real spawned servers.
 * Run with: npm run smoke:runtime
 *
 * This is the suite that guards the app's hardest promise — that stopping a
 * project, or quitting, leaves nothing behind.
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Project, Settings } from '@shared/types'

const scratch = mkdtempSync(join(tmpdir(), 'devlaunchr-runtime-'))
app.setPath('userData', mkdtempSync(join(tmpdir(), 'devlaunchr-runtime-data-')))

let failures = 0
const check = (label: string, condition: boolean, detail = ''): void => {
  if (!condition) failures++
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const SETTINGS: Settings = {
  watchRoots: [],
  scanMaxDepth: 5,
  hasCompletedFirstScan: true,
  portRangeStart: 3400,
  portRangeEnd: 3499,
  defaultPackageManager: 'npm',
  healthCheckTimeoutMs: 20_000,
  launchAtLogin: false,
  autoStopIdleMinutes: null,
  theme: 'system',
  editor: 'vscode',
  editorCustomCommand: '',
  autoInstall: false
}

const project = (id: string, dir: string, command: string, preferredPort: number | null = null): Project => ({
  id,
  name: id,
  path: dir,
  type: 'node-generic',
  startCommand: command,
  preferredPort,
  env: {},
  autoOpen: false,
  favorite: false,
  lastOpenedAt: null
})

/** A server that also spawns a grandchild, so group-kill has something to prove. */
function makeServer(name: string, body: string): string {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'server.js'), body, 'utf8')
  return dir
}

const NORMAL_SERVER = `
const http = require('http')
const { spawn } = require('child_process')

// A detached-looking helper, exactly like esbuild/tsc workers in a real dev server.
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
console.log('GRANDCHILD_PID=' + child.pid)

const port = Number(process.env.PORT)
http.createServer((req, res) => res.end('ok')).listen(port, () => {
  console.log('  ➜  Local:   http://localhost:' + port + '/')
})
`

const IGNORES_PORT_SERVER = `
const http = require('http')
// Deliberately ignores $PORT, the way Django, Rails, and half of Node tooling do.
const port = Number(process.env.PORT) + 11
http.createServer((req, res) => res.end('ok')).listen(port, () => {
  console.log('listening on port ' + port)
})
`

const IS_WIN = process.platform === 'win32'

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Pids listening on a port, via the app's own cross-platform scanner. */
const listenersOn = async (port: number): Promise<string> => {
  const { listListeners } = await import('../src/main/ports')
  return (await listListeners())
    .filter((entry) => entry.port === port)
    .map((entry) => entry.pid)
    .join(' ')
}

void app.whenReady().then(async () => {
  const runtime = await import('../src/main/processManager')
  const ledger = await import('../src/main/ledger')
  const { killProcessTree } = await import('../src/main/platform')

  const logsFor = (id: string): string =>
    runtime.getLogs(id).map((line) => line.text).join('\n')

  // ---------------------------------------------------------------- start
  const normalDir = makeServer('normal', NORMAL_SERVER)
  const a = project('a', normalDir, 'node server.js')
  await runtime.start(a, SETTINGS)

  const stateA = runtime.getState('a')
  check('project reaches running', stateA.status === 'running', stateA.status)
  check('port is inside the configured range', (stateA.port ?? 0) >= 3400 && (stateA.port ?? 0) <= 3499, String(stateA.port))
  check('url is recorded', stateA.url !== null, stateA.url ?? '')
  check('pid is recorded', stateA.pid !== null, String(stateA.pid))
  check('port actually has a listener', (await listenersOn(stateA.port ?? 0)) !== '')

  const grandchildMatch = /GRANDCHILD_PID=(\d+)/.exec(logsFor('a'))
  const grandchildPid = grandchildMatch ? Number(grandchildMatch[1]) : 0
  check('grandchild process was spawned', grandchildPid > 0 && isAlive(grandchildPid), String(grandchildPid))

  // ---------------------------------------------------- port collision
  const b = project('b', makeServer('second', NORMAL_SERVER), 'node server.js', stateA.port)
  await runtime.start(b, SETTINGS)
  const stateB = runtime.getState('b')
  check('second project with the same preferred port still starts', stateB.status === 'running', stateB.status)
  check('second project got a different port', stateB.port !== stateA.port, `${stateA.port} vs ${stateB.port}`)

  // ------------------------------------------------- parsed port override
  const c = project('c', makeServer('ignores-port', IGNORES_PORT_SERVER), 'node server.js')
  await runtime.start(c, SETTINGS)
  const stateC = runtime.getState('c')
  check('server that ignores $PORT still reaches running', stateC.status === 'running', stateC.status)
  check(
    'parsed port overrode the assigned port',
    /following it instead of/.test(logsFor('c')),
    String(stateC.port)
  )
  check('reported port matches the real listener', (await listenersOn(stateC.port ?? 0)) !== '')

  // --------------------------------------------------------- group kill
  const portA = stateA.port ?? 0
  const pidA = stateA.pid ?? 0
  await runtime.stop(a)

  check('status returns to stopped', runtime.getState('a').status === 'stopped')
  check('the server process is gone', !isAlive(pidA))
  check('THE GRANDCHILD IS GONE (group kill)', !isAlive(grandchildPid), `pid ${grandchildPid}`)
  check('nothing listens on the port any more', (await listenersOn(portA)) === '')

  // ------------------------------------------------------------- crash
  const d = project('d', normalDir, 'node -e "process.exit(3)"')
  await runtime.start(d, SETTINGS)
  await sleep(600)
  const stateD = runtime.getState('d')
  check('a server that exits on its own is marked crashed', stateD.status === 'crashed', stateD.status)
  check('the exit code is surfaced', /exit code 3/.test(stateD.lastError ?? ''), stateD.lastError ?? '')

  // ------------------------------------------------- missing command
  const e = project('e', normalDir, 'this-command-does-not-exist-9271')
  await runtime.start(e, SETTINGS)
  await sleep(800)
  check('an unknown command crashes rather than hanging', runtime.getState('e').status === 'crashed')

  // ------------------------------------------------ dependency ecosystems
  const { inspectDependencies, portFromCommand } = await import('../src/main/dependencies')

  // File keys may contain a relative path, so a fixture can create a real
  // virtualenv layout rather than a bare directory.
  const fixture = (name: string, files: Record<string, string>, dirs: string[] = []): string => {
    const dir = join(scratch, name)
    mkdirSync(dir, { recursive: true })
    for (const [file, body] of Object.entries(files)) {
      const target = join(dir, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, body, 'utf8')
    }
    for (const sub of dirs) mkdirSync(join(dir, sub), { recursive: true })
    return dir
  }

  const venvLayout = process.platform === 'win32'
    ? { '.venv/Scripts/Activate.ps1': '' }
    : { '.venv/bin/activate': '' }

  const plan = (dir: string, type: Project['type']) =>
    inspectDependencies({ ...project('x', dir, 'run'), type })

  const npmDir = fixture('eco-npm', { 'package.json': '{}' })
  check('npm project without node_modules', plan(npmDir, 'node-generic').command === 'npm install')

  const pnpmDir = fixture('eco-pnpm', { 'package.json': '{}', 'pnpm-lock.yaml': '' })
  check('pnpm lockfile picks pnpm', plan(pnpmDir, 'node-generic').command === 'pnpm install')

  const bunDir = fixture('eco-bun', { 'package.json': '{}', 'bun.lock': '' })
  check('bun lockfile picks bun', plan(bunDir, 'node-generic').command === 'bun install')

  const declaredDir = fixture('eco-declared', {
    'package.json': JSON.stringify({ packageManager: 'yarn@4.1.0' }),
    'pnpm-lock.yaml': ''
  })
  check(
    'packageManager field outranks the lockfile',
    plan(declaredDir, 'node-generic').command === 'yarn install',
    plan(declaredDir, 'node-generic').command ?? ''
  )

  const installedDir = fixture('eco-installed', { 'package.json': '{}' }, ['node_modules'])
  check('installed node project needs nothing', plan(installedDir, 'node-generic').missing === false)

  const uvDir = fixture('eco-uv', { 'uv.lock': '', 'pyproject.toml': '' })
  check('uv project uses uv sync', plan(uvDir, 'python-generic').command === 'uv sync')

  const poetryDir = fixture('eco-poetry', { 'poetry.lock': '' })
  check('poetry project uses poetry install', plan(poetryDir, 'python-generic').command === 'poetry install')

  const pipDir = fixture('eco-pip', { 'requirements.txt': 'flask\n' })
  const pipPlan = plan(pipDir, 'python-flask')
  check('bare requirements.txt creates a virtualenv', /python3? -m venv \.venv/.test(pipPlan.command ?? ''), pipPlan.command ?? '')
  check('and never installs into system python', !/^pip install/.test(pipPlan.command ?? ''))

  const venvDir = fixture('eco-venv', { 'requirements.txt': '', ...venvLayout })
  check('an existing virtualenv needs nothing', plan(venvDir, 'python-flask').missing === false)

  const phpDir = fixture('eco-php', { 'composer.json': '{}' })
  check('composer project without vendor', plan(phpDir, 'php').command === 'composer install')

  const phpDone = fixture('eco-php-done', { 'composer.json': '{}' }, ['vendor'])
  check('installed php project needs nothing', plan(phpDone, 'php').missing === false)

  const staticDir = fixture('eco-static', { 'index.html': '<html></html>' })
  check('static folders never need installing', plan(staticDir, 'static').missing === false)

  // ------------------------------------------------------ pinned ports
  check(
    'a pinned --port is read from the command',
    portFromCommand('node serve.mjs --root web --port 3000').port === 3000
  )
  check(
    'a pinned port is not treated as honouring $PORT',
    portFromCommand('astro dev --port 4321').honorsEnv === false
  )
  check(
    '$PORT usage is recognised',
    portFromCommand('php -S 127.0.0.1:$PORT').honorsEnv === true
  )
  check(
    'a command with neither reports neither',
    portFromCommand('npm run dev').port === null &&
      portFromCommand('npm run dev').honorsEnv === false
  )

  // -------------------------------------------------- required system tools
  const { inspectRequirements } = await import('../src/main/requirements')

  const reqFor = (dir: string, type: Project['type'], command = 'run') =>
    inspectRequirements({ ...project('r1', dir, command), type })

  const composeReq = reqFor(fixture('req-compose', { 'docker-compose.yml': '' }), 'docker-compose')
  check('a compose project requires docker',
    composeReq.some((r) => r.name === 'docker'), composeReq.map((r) => r.name).join(','))
  check('the requirement explains itself',
    /Docker Compose/i.test(composeReq.find((r) => r.name === 'docker')?.reason ?? ''))

  const phpReq = reqFor(fixture('req-php', { 'composer.json': '{}', 'index.php': '' }), 'php')
  check('a php project requires php and composer',
    ['php', 'composer'].every((name) => phpReq.some((r) => r.name === name)),
    phpReq.map((r) => r.name).join(','))

  const pnpmReq = reqFor(
    fixture('req-pnpm', { 'package.json': '{}', 'pnpm-lock.yaml': '' }),
    'node-generic'
  )
  check('a pnpm lockfile makes pnpm a requirement',
    pnpmReq.some((r) => r.name === 'pnpm'), pnpmReq.map((r) => r.name).join(','))
  check('an npm project does not demand pnpm',
    !reqFor(fixture('req-npm', { 'package.json': '{}' }), 'node-generic').some((r) => r.name === 'pnpm'))

  const staticReq = reqFor(fixture('req-static', { 'index.html': '' }), 'static')
  check('a static project requires nothing', staticReq.length === 0,
    staticReq.map((r) => r.name).join(','))

  const uvReq = reqFor(fixture('req-uv', { 'uv.lock': '', 'pyproject.toml': '' }), 'python-generic')
  check('a uv project requires uv', uvReq.some((r) => r.name === 'uv'),
    uvReq.map((r) => r.name).join(','))

  // The start command is inspected too, for tools the project type does not imply.
  const hugoReq = reqFor(fixture('req-hugo', { 'package.json': '{}' }), 'node-generic', 'hugo server')
  check('a tool named in the start command is required',
    hugoReq.some((r) => r.name === 'hugo'), hugoReq.map((r) => r.name).join(','))

  // node is present on this machine, so it must not be reported as missing.
  check('an installed tool is reported as present',
    reqFor(fixture('req-node', { 'package.json': '{}' }), 'node-generic')
      .find((r) => r.name === 'node')?.present === true)

  // ---------------------------------------------------------- diagnostics
  const { diagnose } = await import('../src/main/diagnostics')

  const diagFor = (
    dir: string,
    command: string,
    logs: string,
    type: Project['type'] = 'node-generic',
    exitCode = 127
  ) =>
    diagnose({
      project: { ...project('d1', dir, command), type },
      exitCode,
      signal: null,
      logs
    })

  // Both shell dialects, because they word it differently and put the command
  // name on opposite sides of the phrase.
  const bashStyle = diagFor(
    fixture('diag-bash', { 'docker-compose.yml': '' }),
    'docker compose up',
    'sh: docker: command not found',
    'docker-compose'
  )
  check('bash-style "not found" names the tool',
    bashStyle?.title === 'Docker is not installed', bashStyle?.title ?? 'null')

  // The exact output from a machine without Docker.
  const dockerDiag = diagFor(
    fixture('diag-compose', { 'docker-compose.yml': '' }),
    'docker compose up',
    'zsh:1: command not found: docker',
    'docker-compose'
  )
  check('missing docker is named, not reported as exit 127',
    dockerDiag?.title === 'Docker is not installed', dockerDiag?.title ?? 'null')
  check('and it offers install guidance',
    dockerDiag?.actions.some((a) => a.kind === 'docs') === true)
  // Whether a one-click install is offered depends on the machine, but if it
  // is offered the command must actually mention the tool.
  const installAction = dockerDiag?.actions.find((a) => a.kind === 'run')
  check('any offered install command names docker',
    installAction === undefined || /docker/i.test((installAction as { command: string }).command),
    installAction ? (installAction as { command: string }).command : 'no package manager present')

  // The exact output from an electron package whose binary never downloaded.
  const electronDiag = diagFor(
    fixture('diag-electron', { 'package.json': '{}' }, ['node_modules']),
    'npm run dev',
    "Error: spawn /x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ENOENT\n  code: 'ENOENT',"
  )
  check("electron's missing binary is recognised",
    /Electron/.test(electronDiag?.title ?? ''), electronDiag?.title ?? 'null')
  check('and it proposes a rebuild command',
    electronDiag?.actions.some((a) => a.kind === 'run' && /rebuild electron/.test(a.command)) === true)

  // A project-local binary missing because nothing is installed.
  const astroDiag = diagFor(
    fixture('diag-astro', { 'package.json': '{}' }),
    'astro dev',
    'sh: astro: command not found'
  )
  check('a project binary points at the install step',
    /dependencies are not installed/i.test(astroDiag?.title ?? ''), astroDiag?.title ?? 'null')
  check('and offers to run it',
    astroDiag?.actions.some((a) => a.kind === 'install') === true)

  const moduleDiag = diagFor(
    fixture('diag-module', { 'package.json': '{}' }, ['node_modules']),
    'node server.js',
    "Error: Cannot find module 'express'"
  )
  check('a missing node module is named', /express/.test(moduleDiag?.title ?? ''), moduleDiag?.title ?? 'null')

  const pyDiag = diagFor(
    fixture('diag-py', { 'requirements.txt': '', ...venvLayout }),
    'python app.py',
    "ModuleNotFoundError: No module named 'flask'",
    'python-flask'
  )
  check('a missing python module is named', /flask/.test(pyDiag?.title ?? ''), pyDiag?.title ?? 'null')

  const scriptDiag = diagFor(
    fixture('diag-script', { 'package.json': '{}' }, ['node_modules']),
    'npm run dev',
    'npm error Missing script: "dev"'
  )
  check('a missing package script is explained',
    /no "dev" script/.test(scriptDiag?.title ?? ''), scriptDiag?.title ?? 'null')

  const cleanDiag = diagFor(
    fixture('diag-clean', { 'package.json': '{}' }, ['node_modules']),
    'node server.js',
    'Server closed gracefully',
    'node-generic',
    1
  )
  check('an unrecognised failure returns no invented diagnosis', cleanDiag === null)

  // ------------------------------------------------- missing dependencies
  const noDeps = join(scratch, 'no-deps')
  mkdirSync(noDeps, { recursive: true })
  writeFileSync(
    join(noDeps, 'package.json'),
    JSON.stringify({ name: 'no-deps', scripts: { dev: 'astro dev' } }),
    'utf8'
  )

  const f = project('f', noDeps, 'astro dev')
  check('a package.json with no node_modules is detected', runtime.dependenciesMissing(f))

  // With auto-install off, a start must refuse rather than spawn something doomed.
  await runtime.start(f, { ...SETTINGS, autoInstall: false })
  const stateF = runtime.getState('f')
  check('start refuses instead of spawning a doomed process', stateF.status === 'crashed', stateF.status)
  check('needsInstall is reported to the UI', stateF.needsInstall === true)
  check('no pid was created', stateF.pid === null)
  check(
    'the message names the real cause, not an exit code',
    /node_modules has not been installed/i.test(stateF.lastError ?? ''),
    stateF.lastError ?? ''
  )

  // With auto-install on, the same start installs first and then runs.
  const autoDir = join(scratch, 'auto-install')
  mkdirSync(join(autoDir, 'src'), { recursive: true })
  writeFileSync(join(autoDir, 'package.json'), JSON.stringify({ name: 'auto' }), 'utf8')
  writeFileSync(join(autoDir, 'server.js'), NORMAL_SERVER, 'utf8')

  const h = project('h', autoDir, 'node server.js')
  // `npm install` with no dependencies is fast and creates node_modules.
  const withInstall = { ...h, installCommand: 'npm install' }
  await runtime.start(withInstall, { ...SETTINGS, autoInstall: true })
  const stateH = runtime.getState('h')
  check('auto-install runs and the project then starts', stateH.status === 'running', stateH.status)
  check(
    'the install output is in the log',
    /npm install/.test(runtime.getLogs('h').map((l) => l.text).join('\n'))
  )
  await runtime.stop(withInstall)

  mkdirSync(join(noDeps, 'node_modules'), { recursive: true })
  check('installed dependencies clear the flag', runtime.dependenciesMissing(f) === false)

  // A non-Node project is never blocked on node_modules.
  const phpish = { ...f, id: 'g', type: 'php' as const, path: scratch }
  check('the check only applies to Node projects', runtime.dependenciesMissing(phpish) === false)

  // ------------------------------------------------------- listening ports
  const { listListeners } = await import('../src/main/ports')
  const listeners = await listListeners()
  const ourPort = runtime.getState('b').port ?? 0
  check('port scan returns entries', listeners.length > 0, `${listeners.length} listeners`)
  check(
    'port scan finds a server we started',
    listeners.some((entry) => entry.port === ourPort),
    `looking for :${ourPort}`
  )
  const mine = listeners.find((entry) => entry.port === ourPort)
  check('scanned entry carries a pid and command', (mine?.pid ?? 0) > 0 && (mine?.command ?? '') !== '')
  check('ports come back sorted', listeners.every((entry, i) => i === 0 || entry.port >= (listeners[i - 1]?.port ?? 0)))

  // --------------------------------------------- adopting external servers
  // A server nobody told devLaunchr about, started the way a terminal would.
  const { findExternalServers } = await import('../src/main/adoption')

  const externalDir = fixture('external-app', {
    'package.json': '{}',
    'server.js': NORMAL_SERVER
  })

  // Windows cannot read another process's cwd, so there a terminal-started
  // server is recognised by its project path on the command line instead.
  const externalProc = spawn(process.execPath, [IS_WIN ? join(externalDir, 'server.js') : 'server.js'], {
    cwd: externalDir,
    // Run as plain Node, the way a terminal would; as Electron it would need
    // a display and, on Linux CI, a sandbox exemption.
    env: { ...process.env, PORT: '3455', ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    detached: true
  })
  await sleep(1200)

  const externalProject = project('ext', externalDir, 'node server.js')
  const servers = await findExternalServers([externalProject], () => false)
  const adoptedServer = servers.find((entry) => entry.projectId === 'ext')

  check('a server started outside devLaunchr is found', adoptedServer !== undefined)
  check('it is matched by evidence, not guessed from the port',
    adoptedServer?.matchedBy === (IS_WIN ? 'commandLine' : 'cwd'), adoptedServer?.matchedBy ?? 'none')
  check('the real port is reported', adoptedServer?.port === 3455, String(adoptedServer?.port))
  check('the owning process is identified', (adoptedServer?.pid ?? 0) > 0)

  // A project devLaunchr already runs itself must never be double-reported.
  const skipped = await findExternalServers([externalProject], (id) => id === 'ext')
  check('a project we already manage is not adopted', skipped.length === 0)

  // Adoption must not invent a match for an unrelated folder.
  const unrelated = project('unrelated', join(scratch, 'eco-npm'), 'npm run dev')
  const noMatch = await findExternalServers([unrelated], () => false)
  check('an unrelated project is not matched to a stranger\'s port',
    noMatch.every((entry) => entry.projectId !== 'unrelated'))

  // Adopting sets the runtime up as running without spawning anything.
  await runtime.detectExternal([externalProject])
  const adopted = runtime.getState('ext')
  check('the adopted project shows as running', adopted.status === 'running', adopted.status)
  check('with the external owner recorded', adopted.external?.pid === externalProc.pid,
    `${adopted.external?.pid} vs ${externalProc.pid}`)
  check('and the correct url', adopted.url === 'http://127.0.0.1:3455/', adopted.url ?? '')

  // Starting it must attach rather than spawn a second copy.
  await runtime.start(externalProject, SETTINGS)
  check('starting an adopted project does not spawn a duplicate',
    runtime.getState('ext').pid === externalProc.pid)

  // Stopping detaches; the foreign process keeps running.
  await runtime.stop(externalProject)
  check('stopping an adopted project only detaches', runtime.getState('ext').status === 'stopped')
  check('the foreign process is left alone', isAlive(externalProc.pid ?? 0))

  // Once it really goes away, the adoption is released.
  if (externalProc.pid) killProcessTree(externalProc.pid, true)
  await sleep(700)
  await runtime.detectExternal([externalProject])
  check('a vanished external server is released', runtime.getState('ext').external === null)

  // ----------------------------------------------------- ledger + reaper
  // b and c are still running and recorded in the ledger, so the reaper should
  // treat them exactly as it would orphans from a crashed previous session.
  const pidB = runtime.getState('b').pid ?? -1
  const pidC = runtime.getState('c').pid ?? -1
  const portB = runtime.getState('b').port ?? 0
  const portC = runtime.getState('c').port ?? 0

  const ledgerBefore = ledger.readLedger()
  check('running projects are recorded in the ledger', ledgerBefore.length >= 2, `${ledgerBefore.length} entries`)

  // A pid that is alive but whose start time does not match must be left alone.
  ledger.record({
    projectId: 'fake',
    name: 'fake',
    pid: process.pid,
    port: null,
    command: 'echo',
    cwd: scratch,
    startedAt: Date.now(),
    psStart: 'Thu Jan  1 00:00:00 1970'
  })
  // A zero pid must never be signalled: kill(-0) hits our own process group.
  ledger.record({
    projectId: 'zero',
    name: 'zero',
    pid: 0,
    port: null,
    command: 'echo',
    cwd: scratch,
    startedAt: Date.now(),
    psStart: ''
  })

  const report = await ledger.reapOrphans()
  await sleep(400)

  check('reaper killed the real orphan groups', report.reaped.length >= 2, `${report.reaped.length} reaped`)
  check('orphaned server b is gone', !isAlive(pidB), `pid ${pidB}`)
  check('orphaned server c is gone', !isAlive(pidC), `pid ${pidC}`)
  check('no listener left on b', (await listenersOn(portB)) === '')
  check('no listener left on c', (await listenersOn(portC)) === '')
  check('pid-recycling guard skipped the mismatched start time', !report.reaped.some((r) => r.projectId === 'fake'))
  check('zero pid was refused', !report.reaped.some((r) => r.projectId === 'zero'))
  check('this very process survived the reaper', isAlive(process.pid))
  check('ledger is cleared after reaping', ledger.readLedger().length === 0)

  // ------------------------------------------------------------ stopAll
  // Everything is already dead; stopAll must be safe to run anyway.
  await runtime.stopAll([a, b, c, d, e])
  await sleep(200)
  check('stopAll over already-dead projects is harmless', isAlive(process.pid))
  check('ledger is empty after stopAll', ledger.readLedger().length === 0)

  console.log(failures === 0 ? '\nall runtime checks passed' : `\n${failures} check(s) failed`)
  app.exit(failures === 0 ? 0 : 1)
})
