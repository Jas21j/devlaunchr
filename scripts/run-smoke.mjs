#!/usr/bin/env node
/**
 * Bundles a smoke harness (TypeScript, path aliases, electron kept external)
 * into the scratch dir and runs it under Electron. Nothing is written into
 * out/, so test code never ends up inside the packaged app.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name) {
  console.error('usage: node scripts/run-smoke.mjs <name>')
  process.exit(2)
}

const outDir = mkdtempSync(join(tmpdir(), 'devlaunchr-smoke-build-'))
const outfile = join(outDir, 'main.cjs')

await build({
  entryPoints: [resolve(ROOT, `scripts/smoke-${name}.ts`)],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile,
  external: ['electron'],
  alias: { '@shared': resolve(ROOT, 'src/shared') },
  logLevel: 'warning'
})

// GitHub's Linux runners ship Chromium's SUID sandbox helper unconfigured,
// which aborts Electron before the first line of the suite runs.
const args = process.platform === 'linux' && process.env.CI ? [outfile, '--no-sandbox'] : [outfile]

// A suite that hangs should fail, not hold a CI runner for six hours.
const result = spawnSync(electron, args, { stdio: 'inherit', timeout: 10 * 60_000, killSignal: 'SIGKILL' })
if (result.error) console.error(`smoke:${name} did not finish: ${result.error.message}`)
process.exit(result.status ?? 1)
