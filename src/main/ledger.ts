import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { isProcessAlive, killProcessTree, processStartTime as readStartTime } from './platform'

export interface LedgerEntry {
  projectId: string
  name: string
  pid: number
  port: number | null
  command: string
  cwd: string
  startedAt: number
  /**
   * The kernel's start timestamp for this pid, captured at spawn. PIDs are
   * recycled; without this, reaping a stale ledger could kill an unrelated
   * process that happens to have inherited the number.
   */
  psStart: string
}

const ledgerPath = (): string => join(app.getPath('userData'), 'running.json')

/**
 * Written synchronously on every spawn and exit. `before-quit` only covers a
 * graceful shutdown — a force-quit, a main-process crash, or a power loss
 * leaves detached children alive holding ports, and this file is the only
 * record that they exist.
 */
function write(entries: LedgerEntry[]): void {
  try {
    writeFileSync(ledgerPath(), JSON.stringify(entries, null, 2), 'utf8')
  } catch {
    // A ledger we cannot write is a degraded reaper, not a failed start.
  }
}

export function readLedger(): LedgerEntry[] {
  try {
    if (!existsSync(ledgerPath())) return []
    const parsed: unknown = JSON.parse(readFileSync(ledgerPath(), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is LedgerEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as LedgerEntry).pid === 'number'
    )
  } catch {
    return []
  }
}

export const processStartTime = readStartTime

export function record(entry: LedgerEntry): void {
  write([...readLedger().filter((e) => e.pid !== entry.pid), entry])
}

export function forget(pid: number): void {
  write(readLedger().filter((entry) => entry.pid !== pid))
}

export function clear(): void {
  write([])
}

const isAlive = isProcessAlive

export interface ReapReport {
  reaped: LedgerEntry[]
  stale: number
}

/**
 * Run once at boot, before any project can be started. Kills process groups
 * left behind by a previous session, but only when the pid is still alive AND
 * its start time matches what we recorded.
 */
export async function reapOrphans(): Promise<ReapReport> {
  const entries = readLedger()
  if (entries.length === 0) return { reaped: [], stale: 0 }

  const reaped: LedgerEntry[] = []
  let stale = 0

  for (const entry of entries) {
    // Guard against a malformed or hand-edited ledger: kill(-0) would signal
    // our own process group.
    if (!Number.isInteger(entry.pid) || entry.pid <= 1) {
      stale++
      continue
    }
    if (!isAlive(entry.pid)) {
      stale++
      continue
    }
    if (entry.psStart && processStartTime(entry.pid) !== entry.psStart) {
      // The pid was recycled by an unrelated process. Leave it alone.
      stale++
      continue
    }

    killProcessTree(entry.pid, false)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    if (isAlive(entry.pid)) killProcessTree(entry.pid, true)
    reaped.push(entry)
  }

  clear()
  return { reaped, stale }
}
