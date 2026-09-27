import { existsSync } from 'node:fs'
import { FALLBACK_PATH_DIRS, probeLoginPath } from './platform'

let cached: string | null = null

/**
 * A GUI-launched .app inherits a minimal PATH — typically /usr/bin:/bin — so
 * `npm`, `pnpm`, `php`, and Homebrew binaries are all invisible to it. The
 * login shell knows the real PATH, so we ask it once at boot and cache the
 * answer.
 *
 * The probe wraps the value in NUL bytes because dotfiles routinely print
 * banners, version notices, and `nvm` output; anything outside the NULs is
 * discarded rather than corrupting the result.
 */
export async function resolveLoginPath(): Promise<string> {
  if (cached) return cached

  const probed = await probeLoginPath()

  const merged = new Set<string>()
  for (const dir of (probed ?? '').split(':')) {
    if (dir) merged.add(dir)
  }
  for (const dir of (process.env['PATH'] ?? '').split(':')) {
    if (dir) merged.add(dir)
  }
  // Even if the probe failed entirely, Homebrew and the system dirs get us
  // far enough to run most projects.
  for (const dir of FALLBACK_PATH_DIRS) {
    if (existsSync(dir)) merged.add(dir)
  }

  cached = [...merged].join(':')
  return cached
}

/** For diagnostics in the log pane. */
export const cachedPath = (): string | null => cached
