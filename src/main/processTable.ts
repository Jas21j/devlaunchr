import { execFile } from 'node:child_process'
import { IS_WINDOWS } from './platform'
import { listListeners, type Listener } from './ports'

/**
 * One cached, asynchronous view of the machine's processes and listening
 * sockets.
 *
 * Every question devLaunchr asks about ports — is this free, who holds it, is
 * that holder ours, which project is this terminal server — used to shell out
 * on its own, often synchronously and once per listener. A start could block
 * the main process for seconds while it ran `lsof` thirty times. Everything now
 * reads from one short-lived snapshot, and concurrent callers share a single
 * in-flight lookup.
 */

const LISTENER_TTL_MS = 800
const TABLE_TTL_MS = 800

function run(file: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      // Non-zero exits are normal here (lsof reports unreadable processes);
      // whatever was printed is still valid.
      (_error, stdout) => resolve(stdout ?? '')
    )
  })
}

// ------------------------------------------------------------- listeners

let listenerCache: { at: number; data: Listener[] } | null = null
let listenerInflight: Promise<Listener[]> | null = null

/** Every listening TCP socket, at most `maxAgeMs` old. */
export function listeners(maxAgeMs = LISTENER_TTL_MS): Promise<Listener[]> {
  if (listenerCache && Date.now() - listenerCache.at <= maxAgeMs) {
    return Promise.resolve(listenerCache.data)
  }
  if (listenerInflight) return listenerInflight
  listenerInflight = listListeners()
    .catch(() => [] as Listener[])
    .then((data) => {
      listenerCache = { at: Date.now(), data }
      listenerInflight = null
      return data
    })
  return listenerInflight
}

// --------------------------------------------------------- process table

export interface ProcessInfo {
  pid: number
  ppid: number
  /** Process group; null on Windows, which has no equivalent. */
  pgid: number | null
}

let tableCache: { at: number; data: Map<number, ProcessInfo> } | null = null
let tableInflight: Promise<Map<number, ProcessInfo>> | null = null

async function readTable(): Promise<Map<number, ProcessInfo>> {
  const table = new Map<number, ProcessInfo>()
  if (IS_WINDOWS) {
    const out = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
    ], 10000)
    for (const line of out.split(/\r?\n/)) {
      const [pid, ppid] = line.trim().split(/\s+/).map((n) => Number.parseInt(n, 10))
      if (Number.isInteger(pid) && Number.isInteger(ppid)) table.set(pid!, { pid: pid!, ppid: ppid!, pgid: null })
    }
    return table
  }
  const out = await run('ps', ['-A', '-o', 'pid=,ppid=,pgid='])
  for (const line of out.split('\n')) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map((n) => Number.parseInt(n, 10))
    if (Number.isInteger(pid) && Number.isInteger(ppid)) {
      table.set(pid!, { pid: pid!, ppid: ppid!, pgid: Number.isInteger(pgid) ? pgid! : null })
    }
  }
  return table
}

export function processTable(maxAgeMs = TABLE_TTL_MS): Promise<Map<number, ProcessInfo>> {
  if (tableCache && Date.now() - tableCache.at <= maxAgeMs) return Promise.resolve(tableCache.data)
  if (tableInflight) return tableInflight
  tableInflight = readTable()
    .catch(() => new Map<number, ProcessInfo>())
    .then((data) => {
      tableCache = { at: Date.now(), data }
      tableInflight = null
      return data
    })
  return tableInflight
}

/**
 * Whether `pid` is `root` or was started by it, directly or through any number
 * of intermediate processes. On Unix the process group counts too, because a
 * dev server's workers are sometimes reparented to init but keep the group.
 */
export function belongsTo(pid: number, root: number, table: Map<number, ProcessInfo>): boolean {
  if (pid === root) return true
  const info = table.get(pid)
  if (info?.pgid !== null && info?.pgid === root) return true
  let current = info
  for (let hops = 0; current && hops < 64; hops++) {
    if (current.ppid === root) return true
    if (current.ppid <= 1) return false
    current = table.get(current.ppid)
  }
  return false
}

/** Drops every cached view. Called whenever something starts or stops. */
export function invalidate(): void {
  listenerCache = null
  tableCache = null
}

// ------------------------------------------- batched per-process details

/**
 * Working directories for many processes in one `lsof` call, instead of one
 * call each. Windows cannot read another process's cwd cheaply, so it returns
 * an empty map there and callers fall back to command lines.
 */
export async function workingDirectories(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  const wanted = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 1))]
  if (IS_WINDOWS || wanted.length === 0) return result
  const out = await run('lsof', ['-a', '-d', 'cwd', '-p', wanted.join(','), '-Fpn'])
  let pid = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number.parseInt(line.slice(1), 10) || 0
    else if (line.startsWith('n') && pid) result.set(pid, line.slice(1).trim())
  }
  return result
}

/** Full command lines for many processes in one call. */
export async function commandLines(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  const wanted = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 1))]
  if (wanted.length === 0) return result
  if (IS_WINDOWS) {
    const filter = wanted.map((pid) => `ProcessId=${pid}`).join(' OR ')
    const out = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`
    ], 10000)
    for (const line of out.split(/\r?\n/)) {
      const tab = line.indexOf('\t')
      const pid = Number.parseInt(line.slice(0, tab), 10)
      if (tab > 0 && Number.isInteger(pid)) result.set(pid, line.slice(tab + 1).trim())
    }
    return result
  }
  const out = await run('ps', ['-o', 'pid=,command=', '-p', wanted.join(',')])
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match) result.set(Number.parseInt(match[1]!, 10), match[2]!.trim())
  }
  return result
}
