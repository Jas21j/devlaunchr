/**
 * Stops servers nobody is using.
 *
 * "Using" is judged from two signals the app can see without instrumenting
 * the project: the server writing output (dev servers log requests, rebuilds
 * and hot reloads, so a quiet log means nothing is happening), and the user
 * having the project on screen. Adopted servers are never touched — devLaunchr
 * did not start them, so it does not get to stop them.
 */

export interface IdleCandidate {
  projectId: string
  /** When the server came up; a fresh server is never idle. */
  startedAt: number | null
  /** Last log line or on-screen view, whichever was later; null if never. */
  lastActivity: number | null
  /** True for servers devLaunchr adopted rather than started. */
  external: boolean
}

/**
 * The projects that have been idle for longer than `minutes`.
 *
 * `minutes` of null or below 1 means the feature is off.
 */
export function idleProjects(candidates: IdleCandidate[], now: number, minutes: number | null): string[] {
  if (minutes === null || minutes < 1) return []
  const limit = minutes * 60_000
  return candidates
    .filter((candidate) => {
      if (candidate.external) return false
      const since = Math.max(candidate.startedAt ?? 0, candidate.lastActivity ?? 0)
      // No timestamp at all means we cannot tell; leave it running.
      if (since === 0) return false
      return now - since >= limit
    })
    .map((candidate) => candidate.projectId)
}

const activity = new Map<string, number>()

/** Records that a project did something, or was looked at, just now. */
export function touch(projectId: string, at = Date.now()): void {
  activity.set(projectId, at)
}

export const lastActivity = (projectId: string): number | null => activity.get(projectId) ?? null

export function forget(projectId: string): void {
  activity.delete(projectId)
}
