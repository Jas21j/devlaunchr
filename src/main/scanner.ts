import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { detectProject } from './detect'
import type { Detection } from '@shared/ipc'

export interface ScanCandidate {
  path: string
  name: string
  detection: Detection
  alreadyAdded: boolean
  /** Bytes are not measured; this is the mtime of the project root. */
  modifiedAt: number
}

export interface ScanProgress {
  scanned: number
  found: number
  current: string
}

export interface ScanOutcome {
  candidates: ScanCandidate[]
  /** Folders macOS refused to let us read (TCC privacy gates, mostly). */
  denied: string[]
}

export interface ScanOptions {
  roots: string[]
  maxDepth: number
  onProgress?: (progress: ScanProgress) => void
  isKnownPath: (path: string) => boolean
  signal?: { cancelled: boolean }
}

/**
 * Directories that can never contain a project worth launching, or that are
 * large enough that walking them would dominate the scan. Matched by exact
 * folder name.
 */
const SKIP_NAMES = new Set([
  'node_modules', 'bower_components', 'jspm_packages',
  '.git', '.svn', '.hg',
  'vendor', 'dist', 'build', 'out', 'target', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo', '.parcel-cache', '.cache',
  'venv', '.venv', 'env', '.env', '__pycache__', '.tox', '.mypy_cache', '.pytest_cache',
  'Pods', 'DerivedData', '.gradle', '.m2',
  'Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Public',
  '.Trash', '.npm', '.yarn', '.pnpm-store', '.bun', '.nvm', '.cargo', '.rustup',
  '.docker', '.orbstack', '.colima', '.local', '.cursor', '.vscode-server',
  'Creative Cloud Files'
])

/** Bundle-style folders that macOS presents as single files. */
const SKIP_SUFFIXES = [
  '.app', '.framework', '.bundle', '.xcodeproj', '.xcworkspace',
  '.photoslibrary', '.musiclibrary', '.tvlibrary', '.fcpbundle', '.sparsebundle'
]

/** Extra locations where local sites live outside the home folder. */
const EXTRA_ROOTS = [
  '/Library/WebServer/Documents',
  '/Applications/MAMP/htdocs',
  '/opt/homebrew/var/www',
  '/usr/local/var/www'
]

function shouldSkip(name: string): boolean {
  if (SKIP_NAMES.has(name)) return true
  if (name.startsWith('.') && name !== '.') return true
  return SKIP_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/**
 * A folder that is definitely runnable ends the descent — its subfolders are
 * its own source tree, not separate projects. A folder that merely *looks*
 * like a project (a package.json with no runnable script, e.g. a monorepo or a
 * scratch container) is still descended into, because the real projects are
 * usually one level below it.
 *
 * `static` counts as runnable despite having no command: the built-in server
 * runs it.
 */
const isTerminal = (detection: Detection): boolean =>
  detection.type !== 'custom' &&
  (detection.startCommand.length > 0 || detection.type === 'static')

export function defaultRoots(): string[] {
  const home = homedir()
  const roots = [home]
  for (const extra of EXTRA_ROOTS) {
    if (existsSync(extra)) roots.push(extra)
  }
  return roots
}

export async function scan(options: ScanOptions): Promise<ScanOutcome> {
  const { roots, maxDepth, onProgress, isKnownPath, signal } = options

  const found: ScanCandidate[] = []
  const denied = new Set<string>()
  const seen = new Set<string>()
  let scanned = 0
  let lastReport = 0

  const report = (current: string): void => {
    if (!onProgress) return
    const now = Date.now()
    // Progress is cosmetic; throttling it keeps IPC off the hot path.
    if (now - lastReport < 80) return
    lastReport = now
    onProgress({ scanned, found: found.length, current })
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (signal?.cancelled) return
    if (depth > maxDepth) return
    if (seen.has(dir)) return
    seen.add(dir)

    scanned++
    report(dir)

    let detection: Detection
    try {
      detection = detectProject(dir)
    } catch {
      return
    }

    if (isTerminal(detection)) {
      let modifiedAt = 0
      try {
        modifiedAt = (await stat(dir)).mtimeMs
      } catch {
        // A project we cannot stat is still a project.
      }
      found.push({
        path: dir,
        name: basename(dir),
        detection,
        alreadyAdded: isKnownPath(dir),
        modifiedAt
      })
      return
    }

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      // macOS gates Desktop, Documents, and Downloads behind a privacy prompt.
      // Swallowing that silently would make the scan quietly incomplete and
      // look like a detection bug, so denied folders are reported instead.
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES') denied.add(dir)
      return
    }

    const children = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => !shouldSkip(name))
      .map((name) => join(dir, name))

    // Bounded fan-out: a home directory can hold thousands of folders, and
    // unbounded Promise.all would exhaust the file-descriptor limit.
    const CONCURRENCY = 12
    for (let i = 0; i < children.length; i += CONCURRENCY) {
      if (signal?.cancelled) return
      await Promise.all(
        children.slice(i, i + CONCURRENCY).map((child) => walk(child, depth + 1))
      )
    }
  }

  await Promise.all(roots.map((root) => walk(root, 0)))

  onProgress?.({ scanned, found: found.length, current: '' })

  // Most-recently-touched first: the project you were last working on is the
  // one you are most likely to want.
  return {
    candidates: found.sort((a, b) => b.modifiedAt - a.modifiedAt),
    denied: [...denied].sort()
  }
}
