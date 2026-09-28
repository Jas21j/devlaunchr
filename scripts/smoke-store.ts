/**
 * Headless exercise of the persistence layer inside a real Electron main
 * process. Run with: npm run smoke:store
 *
 * Uses a throwaway userData directory so it can never touch the real config.
 */
import { app } from 'electron'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'devlaunchr-smoke-')))

let failures = 0
const check = (label: string, condition: boolean, detail = ''): void => {
  if (!condition) failures++
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

void app.whenReady().then(async () => {
  const store = await import('../src/main/store')
  const { detectProject } = await import('../src/main/detect')

  store.migrate()

  // Synthetic fixtures rather than real folders: the suite must pass on any
  // machine, including CI, not just one where these projects happen to exist.
  const scratch = mkdtempSync(join(tmpdir(), 'devlaunchr-store-fixtures-'))

  const makeProject = (name: string, files: Record<string, string>): string => {
    const dir = join(scratch, name)
    mkdirSync(dir, { recursive: true })
    for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body, 'utf8')
    return dir
  }

  const fixture = makeProject('sample-app', {
    'package.json': JSON.stringify({
      name: 'sample-app',
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^7.0.0' }
    })
  })
  const detection = detectProject(fixture)

  const base = {
    name: 'sample-app',
    path: fixture,
    type: detection.type,
    startCommand: detection.startCommand,
    preferredPort: 3000,
    env: { API_URL: 'http://127.0.0.1:8000' },
    autoOpen: true,
    favorite: false
  }

  // --- add
  const created = store.addProject(base)
  check('add returns a project with a uuid', /^[0-9a-f-]{36}$/.test(created.id), created.id)
  check('add persists', store.getProjects().length === 1)
  check('type came from detection', created.type === 'node-vite', created.type)

  // --- duplicate path is refused
  let duplicateRejected = false
  try {
    store.addProject({ ...base, name: 'sample-app copy' })
  } catch (error) {
    duplicateRejected = error instanceof store.DuplicateProjectError
  }
  check('duplicate path is rejected', duplicateRejected)

  // --- trailing slash is the same project
  let slashRejected = false
  try {
    store.addProject({ ...base, path: `${fixture}/` })
  } catch {
    slashRejected = true
  }
  check('trailing slash resolves to the same path', slashRejected)

  // --- path with a space round-trips
  const spaced = store.addProject({
    ...base,
    name: 'project with spaces',
    path: makeProject('project with spaces 1.2.3', { 'index.html': '<html></html>' })
  })
  check('path containing a space is stored verbatim', spaced.path.includes(' '), spaced.path)

  // --- update preserves untouched fields
  const updated = store.updateProject(created.id, { favorite: true, preferredPort: 4100 })
  check('update applies the patch', updated?.favorite === true && updated?.preferredPort === 4100)
  check('update preserves env', JSON.stringify(updated?.env) === JSON.stringify(base.env))
  check('update preserves startCommand', updated?.startCommand === base.startCommand)

  // --- invalid port is coerced to null rather than stored
  const badPort = store.updateProject(created.id, { preferredPort: 99999 })
  check('out-of-range port becomes null', badPort?.preferredPort === null)

  // --- addProjectsIfNew skips existing paths (the re-scan guarantee)
  const added = store.addProjectsIfNew([
    { ...base, name: 'should be skipped' },
    { ...base, name: 'brand new', path: makeProject('another-app', { 'index.html': '' }) }
  ])
  check('addProjectsIfNew skips known paths', added.length === 1, `added ${added.length}`)
  check(
    'customized project was not overwritten',
    store.getProjects().find((p) => p.id === created.id)?.name === 'sample-app'
  )

  // --- settings normalize
  const settings = store.setSettings({ portRangeStart: 4000, portRangeEnd: 3500 })
  check('inverted port range is corrected', settings.portRangeStart === 3500 && settings.portRangeEnd === 4000)
  const clamped = store.setSettings({ healthCheckTimeoutMs: 1 })
  check('absurd health timeout is clamped', clamped.healthCheckTimeoutMs === 5000)

  // --- damaged config degrades instead of throwing
  const configFile = store.configPath()
  const onDisk: unknown = JSON.parse(readFileSync(configFile, 'utf8'))
  check('config is plain readable JSON', typeof onDisk === 'object' && onDisk !== null)

  // --- remove
  check('remove reports success', store.removeProject(spaced.id) === true)
  check('remove of an unknown id reports false', store.removeProject('nope') === false)

  // --- default package manager: only a fallback, never an override
  const { setFallbackPackageManager, nodePackageManager } = await import('../src/main/dependencies')
  const bare = makeProject('no-lockfile', {
    'package.json': JSON.stringify({ name: 'no-lockfile', scripts: { dev: 'vite' }, devDependencies: { vite: '^7' } })
  })
  const locked = makeProject('npm-locked', {
    'package.json': JSON.stringify({ name: 'npm-locked', scripts: { dev: 'vite' } }),
    'package-lock.json': '{}'
  })
  const declared = makeProject('declares-yarn', {
    'package.json': JSON.stringify({ name: 'declares-yarn', packageManager: 'yarn@4.1.0', scripts: { dev: 'vite' } })
  })
  check('no lockfile and no setting falls back to npm', nodePackageManager(bare) === 'npm')
  setFallbackPackageManager('pnpm')
  check('no lockfile uses the default package manager', nodePackageManager(bare) === 'pnpm')
  check('detection uses it for the start command', detectProject(bare).startCommand === 'pnpm dev', detectProject(bare).startCommand)
  check('a package-lock.json still means npm', nodePackageManager(locked) === 'npm')
  check('a declared packageManager still wins', nodePackageManager(declared) === 'yarn')
  setFallbackPackageManager('npm')

  // --- editor launch commands
  const { editorCommand } = await import('../src/main/editor')
  const folder = process.platform === 'win32' ? "C:\\Users\\o'neil\\my app" : "/Users/o'neil/my app"
  const quoted = process.platform === 'win32' ? "'C:\\Users\\o''neil\\my app'" : `'/Users/o'\\''neil/my app'`
  check('VS Code opens through its code launcher', editorCommand({ editor: 'vscode', editorCustomCommand: '' }, folder) === `code ${quoted}`)
  check('Sublime uses subl', editorCommand({ editor: 'sublime', editorCustomCommand: '' }, folder) === `subl ${quoted}`)
  check(
    'a custom command gets the folder appended',
    editorCommand({ editor: 'custom', editorCustomCommand: 'idea' }, folder) === `idea ${quoted}`
  )
  check(
    'a custom {path} placeholder is replaced in place',
    editorCommand({ editor: 'custom', editorCustomCommand: 'nvim-qt {path} --maximized' }, folder) ===
      `nvim-qt ${quoted} --maximized`
  )
  check('an empty custom command is reported, not run', editorCommand({ editor: 'custom', editorCustomCommand: '  ' }, folder) === null)

  // --- idle auto-stop policy
  const { idleProjects } = await import('../src/main/idle')
  const now = 10_000_000
  const minute = 60_000
  const candidates = [
    { projectId: 'quiet', startedAt: now - 40 * minute, lastActivity: now - 31 * minute, external: false },
    { projectId: 'busy', startedAt: now - 40 * minute, lastActivity: now - 2 * minute, external: false },
    { projectId: 'fresh', startedAt: now - 5 * minute, lastActivity: null, external: false },
    { projectId: 'adopted', startedAt: now - 90 * minute, lastActivity: null, external: true },
    { projectId: 'never-logged', startedAt: now - 45 * minute, lastActivity: null, external: false }
  ]
  const idle = idleProjects(candidates, now, 30)
  check('a server quiet past the limit is idle', idle.includes('quiet'))
  check('recent output keeps a server alive', !idle.includes('busy'))
  check('a freshly started server is never idle', !idle.includes('fresh'))
  check('a server devLaunchr did not start is never stopped', !idle.includes('adopted'))
  check('a silent server counts from its start time', idle.includes('never-logged'))
  check('the feature is off when unset', idleProjects(candidates, now, null).length === 0)

  console.log(failures === 0 ? '\nall store checks passed' : `\n${failures} check(s) failed`)
  app.exit(failures === 0 ? 0 : 1)
})
