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

const result = spawnSync(electron, [outfile], { stdio: 'inherit' })
process.exit(result.status ?? 1)
