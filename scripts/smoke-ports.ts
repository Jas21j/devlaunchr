/**
 * Port exclusivity: one project, one port, and the preview always shows that
 * project. Run with: npm run smoke:ports
 *
 * The bug this guards against: on macOS a listening socket can share a port
 * with another listener bound to a different address. Another site on
 * 127.0.0.1:P, a new project on 0.0.0.0:P or ::1:P, both "work" — and
 * http://127.0.0.1:P shows the other site. Every case below starts a foreign
 * server first and then asks what the preview would actually display.
 */
import { app } from 'electron'
import { createServer, get, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project, Settings } from '@shared/types'

const scratch = mkdtempSync(join(tmpdir(), 'devlaunchr-ports-'))
app.setPath('userData', mkdtempSync(join(tmpdir(), 'devlaunchr-ports-data-')))

let failures = 0
const check = (label: string, condition: boolean, detail = ''): void => {
  if (!condition) failures++
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const SETTINGS: Settings = {
  watchRoots: [], scanMaxDepth: 5, hasCompletedFirstScan: true,
  portRangeStart: 3600, portRangeEnd: 3699, defaultPackageManager: 'npm',
  healthCheckTimeoutMs: 15_000, launchAtLogin: false, autoStopIdleMinutes: null,
  theme: 'system', editor: 'vscode', editorCustomCommand: '', autoInstall: false
}

const project = (id: string, dir: string, command: string, preferredPort: number | null = null): Project => ({
  id, name: id, path: dir, type: 'node-generic', startCommand: command, preferredPort,
  env: {}, autoOpen: false, favorite: false, lastOpenedAt: null
})

/** A site started by someone else, bound to one specific address. */
function foreign(port: number, host: string, body: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => res.end(body))
    server.once('error', reject)
    server.listen({ port, host }, () => resolve(server))
  })
}

function fetchBody(url: string): Promise<string> {
  return new Promise((resolve) => {
    get(url, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve(body))
    }).on('error', (error) => resolve(`ERR ${error.message}`))
  })
}

/** A project server whose body names itself, so the preview can be identified. */
function makeServer(name: string, listen: string): string {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'server.js'), `
const http = require('http')
const arg = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null }
const port = Number(arg('--port') || process.env.PORT)
const server = http.createServer((req, res) => res.end('PROJECT:${name}'))
${listen}
`, 'utf8')
  return dir
}

void app.whenReady().then(async () => {
  const runtime = await import('../src/main/processManager')
  const registry = await import('../src/main/portRegistry')
  const { effectiveCommand } = await import('../src/main/frameworkPorts')
  const { listListeners } = await import('../src/main/ports')

  // ------------------------------------------------ 1. the free-port check
  const p1 = 3611
  const f1 = await foreign(p1, '127.0.0.1', 'FOREIGN')
  check('a port held on 127.0.0.1 only is NOT free', !(await registry.isPortFree(p1)))
  const f1b = await foreign(3612, '::1', 'FOREIGN6')
  check('a port held on ::1 only is NOT free', !(await registry.isPortFree(3612)))
  check('an untouched port is free', await registry.isPortFree(3613))

  // ------------------- 2. preferred port is taken on 127.0.0.1 by another site
  const a = project('a', makeServer('a', `server.listen(port, () => console.log('Local: http://localhost:' + port + '/'))`), 'node server.js', p1)
  await runtime.start(a, SETTINGS)
  const sa = runtime.getState('a')
  check('project avoids a port another site holds on 127.0.0.1', sa.port !== p1, String(sa.port))
  check('and reaches running', sa.status === 'running', sa.status)
  check('and its preview shows THIS project', (await fetchBody(sa.url ?? '')) === 'PROJECT:a', sa.url ?? '')
  await runtime.stop(a)

  // ---------- 3. project hardcodes the other site's port and binds wildcard
  const b = project('b', makeServer('b', `server.listen({ port, host: '0.0.0.0' })`), `node server.js --port ${p1}`)
  await runtime.start(b, SETTINGS)
  await sleep(300)
  const sb = runtime.getState('b')
  const bBody = sb.url ? await fetchBody(sb.url) : 'no preview'
  check('a wildcard bind sharing a port never previews the other site', bBody !== 'FOREIGN', `${sb.status} ${sb.url} -> ${bBody}`)
  check('the collision is reported as a conflict', sb.status === 'crashed' && sb.conflict !== null, sb.lastError ?? '')
  check('naming the process that holds it', sb.conflict?.pid === process.pid, String(sb.conflict?.pid))
  await runtime.stop(b)

  // ------------- 4. project hardcodes the other site's port and binds ::1
  const c = project('c', makeServer('c', `server.listen({ port, host: '::1' })`), `node server.js --port ${p1}`)
  await runtime.start(c, SETTINGS)
  await sleep(300)
  const sc = runtime.getState('c')
  const cBody = sc.url ? await fetchBody(sc.url) : 'no preview'
  check('an ::1 bind sharing a port never previews the other site', cBody !== 'FOREIGN', `${sc.status} ${sc.url} -> ${cBody}`)
  check('and is reported as a conflict', sc.status === 'crashed' && sc.conflict !== null, sc.lastError ?? '')
  await runtime.stop(c)

  // ----- 5. project announces the other site's port but listens elsewhere
  const d = project('d', makeServer('d', `
const real = port + 7
console.log('  ➜  Local:   http://localhost:${p1}/')
server.listen(real, () => console.log('actually listening on port ' + real))`), 'node server.js')
  await runtime.start(d, SETTINGS)
  const sd = runtime.getState('d')
  check('a false announcement is not followed', sd.port !== p1, String(sd.port))
  check('and the preview shows THIS project', sd.url !== null && (await fetchBody(sd.url)) === 'PROJECT:d', sd.url ?? '')
  await runtime.stop(d)

  // --- 6. a Vite-like server: ignores PORT, binds ::1 on the other site's
  //        port, and announces it. The exact shape of the reported bug.
  const e = project('e', makeServer('e', `
server.listen({ port: ${p1}, host: '::1' }, () => console.log('  ➜  Local:   http://localhost:${p1}/'))`), 'node server.js')
  await runtime.start(e, SETTINGS)
  await sleep(300)
  const se = runtime.getState('e')
  const eBody = se.url ? await fetchBody(se.url) : 'no preview'
  check('a server co-binding ::1 never previews the other site', eBody !== 'FOREIGN', `${se.status} ${se.url} -> ${eBody}`)
  check('and is reported as a conflict naming the other site', se.status === 'crashed' && se.conflict?.pid === process.pid, `${se.status} ${se.conflict?.pid} ${se.lastError ?? ''}`)
  const leftovers = (await listListeners()).filter((entry) => entry.port === p1 && entry.pid !== process.pid)
  check('and its server is not left running on that port', leftovers.length === 0, leftovers.map((l) => `${l.pid}@${l.address}`).join(' '))
  await runtime.stop(e)

  // --- 7. the reported case, exactly: another site runs `next dev
  //        --hostname 0.0.0.0` on 3000; this project's package.json script
  //        runs `node serve.mjs --port 3000`, which binds dual-stack. macOS
  //        lets both listen, and 127.0.0.1 reaches the other site.
  const p7 = 3614
  const f7 = await foreign(p7, '0.0.0.0', 'FOREIGN-NEXT')
  const wDir = makeServer('w', `server.listen(port, () => console.log('West Park\\n  http://localhost:' + port))`)
  writeFileSync(join(wDir, 'package.json'), JSON.stringify({ scripts: { dev: `node server.js --port ${p7}` } }), 'utf8')
  mkdirSync(join(wDir, 'node_modules'), { recursive: true })
  const w = project('w', wDir, 'npm run dev')
  const began = Date.now()
  await runtime.start(w, SETTINGS)
  const sw = runtime.getState('w')
  const wBody = sw.url ? await fetchBody(sw.url) : 'no preview'
  check('a port pinned inside a package.json script never previews the other site', wBody !== 'FOREIGN-NEXT', `${sw.status} ${sw.url} -> ${wBody}`)
  check('and is refused before spawning, naming the holder', sw.status === 'crashed' && sw.conflict?.pid === process.pid && sw.pid === null, `${sw.status} ${sw.conflict?.pid} ${sw.lastError ?? ''}`)
  check('and says where the port is pinned', /"dev" script in package\.json/.test(sw.lastError ?? ''), sw.lastError ?? '')
  check('and does not wait for a timeout to say so', Date.now() - began < 3000, `${Date.now() - began}ms`)
  await runtime.stop(w)
  f7.close()

  // --- 8. the same project with its port free runs on that port, and only it
  const w2 = project('w2', wDir, 'npm run dev')
  await runtime.start(w2, SETTINGS)
  const sw2 = runtime.getState('w2')
  check('a free script-pinned port is used directly', sw2.status === 'running' && sw2.port === p7, `${sw2.status} ${sw2.port}`)
  check('and its preview shows THIS project', sw2.url !== null && (await fetchBody(sw2.url)) === 'PROJECT:w', sw2.url ?? '')
  await runtime.stop(w2)

  f1.close()
  f1b.close()

  // ------------------------------------ 9. framework port injection
  const pkgDir = (name: string, pkg: object): string => {
    const dir = join(scratch, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
    return dir
  }
  const vite = pkgDir('fw-vite', { scripts: { dev: 'vite' }, devDependencies: { vite: '7' } })
  const astro = pkgDir('fw-astro', { scripts: { dev: 'astro dev' }, dependencies: { astro: '5' } })
  const next = pkgDir('fw-next', { scripts: { dev: 'next dev' }, dependencies: { next: '15' } })
  const pinned = pkgDir('fw-pinned', { scripts: { dev: 'astro dev --port 4380' }, dependencies: { astro: '5' } })
  const combo = pkgDir('fw-combo', { scripts: { dev: 'concurrently "vite" "tsc -w"' }, devDependencies: { vite: '7' } })

  const eff = (dir: string, command: string): string => effectiveCommand({ ...project('x', dir, command), type: 'node-vite' })
  check('vite gets its port, strict, on 127.0.0.1', eff(vite, 'npm run dev') === 'npm run dev -- --port $PORT --strictPort --host 127.0.0.1', eff(vite, 'npm run dev'))
  check('pnpm passes flags without a separator', eff(vite, 'pnpm dev') === 'pnpm dev --port $PORT --strictPort --host 127.0.0.1', eff(vite, 'pnpm dev'))
  check('astro gets its port on 127.0.0.1', eff(astro, 'npm run dev') === 'npm run dev -- --port $PORT --host 127.0.0.1', eff(astro, 'npm run dev'))
  check('next gets its port on 127.0.0.1', eff(next, 'npm run dev') === 'npm run dev -- --port $PORT --hostname 127.0.0.1', eff(next, 'npm run dev'))
  check('a script that pins its own port is left alone', eff(pinned, 'npm run dev') === 'npm run dev')
  check('a compound script is left alone', eff(combo, 'npm run dev') === 'npm run dev')
  check('a custom command is left alone', eff(vite, 'node server.js') === 'node server.js')

  await runtime.stopAll([])
  console.log(failures === 0 ? '\nall port checks passed' : `\n${failures} port check(s) FAILED`)
  app.exit(failures === 0 ? 0 : 1)
})
