import { execFile } from 'node:child_process'
import { IS_WINDOWS } from './platform'

export interface Listener {
  port: number
  pid: number
  /** Process name as the OS reports it, e.g. "node", "Docker", "postgres". */
  command: string
  /** "127.0.0.1", "*", "::1" — what the socket is bound to. */
  address: string
  user: string
}

/**
 * Every TCP port currently being listened on by this machine, ours or not.
 *
 * `lsof` is used rather than a Node socket sweep because it reports the owning
 * process, which is the whole point: the useful question is not "is 3000 taken"
 * but "what is holding 3000".
 */
export function listListeners(): Promise<Listener[]> {
  return IS_WINDOWS ? listWindows() : listUnix()
}

function listUnix(): Promise<Listener[]> {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      // -nP skips DNS and service-name lookups, which otherwise make this slow.
      ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcnLu'],
      { timeout: 8000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (_error, stdout) => {
        // lsof exits non-zero when some processes are unreadable, which is
        // normal for other users' processes; whatever it did print is valid.
        if (!stdout) return resolve([])
        resolve(parse(stdout))
      }
    )
  })
}

/**
 * Windows has no lsof. `netstat -ano` gives port-to-pid, and `tasklist` turns
 * the pid into a name, which is the part users actually need.
 */
function listWindows(): Promise<Listener[]> {
  return new Promise((resolve) => {
    execFile(
      'netstat',
      // No -p filter: `-p TCP` lists IPv4 only, which hid every ::1 socket
      // and with it every port shared across address families.
      ['-ano'],
      { timeout: 8000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (_error, stdout) => {
        if (!stdout) return resolve([])

        const listeners: Listener[] = []
        const seen = new Set<string>()

        for (const line of stdout.split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/)
          if (parts.length < 5 || parts[0]?.toUpperCase() !== 'TCP') continue
          if (parts[3]?.toUpperCase() !== 'LISTENING') continue

          const local = parts[1] ?? ''
          const match = /^(.*):(\d+)$/.exec(local)
          const portText = match?.[2]
          const pid = Number.parseInt(parts[4] ?? '', 10)
          if (!portText || !Number.isInteger(pid)) continue

          const port = Number.parseInt(portText, 10)
          const key = `${pid}:${port}`
          if (seen.has(key)) continue
          seen.add(key)

          listeners.push({
            port,
            pid,
            command: '',
            address: (match?.[1] ?? '').replace(/^\[|\]$/g, '') || '*',
            user: ''
          })
        }

        execFile(
          'tasklist',
          ['/FO', 'CSV', '/NH'],
          { timeout: 8000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
          (_taskError, taskOut) => {
            const names = new Map<number, string>()
            for (const line of (taskOut ?? '').split(/\r?\n/)) {
              const fields = line.match(/"([^"]*)"/g)
              if (!fields || fields.length < 2) continue
              const name = fields[0]?.slice(1, -1) ?? ''
              const pid = Number.parseInt(fields[1]?.slice(1, -1) ?? '', 10)
              if (Number.isInteger(pid) && name) names.set(pid, name)
            }
            for (const listener of listeners) {
              listener.command = names.get(listener.pid) ?? 'unknown'
            }
            resolve(listeners.sort((a, b) => a.port - b.port))
          }
        )
      }
    )
  })
}

/**
 * Parses lsof's field output (-F). Each record starts with `p<pid>`, and the
 * fields that follow apply to it until the next `p`.
 */
function parse(output: string): Listener[] {
  const listeners: Listener[] = []
  const seen = new Set<string>()

  let pid = 0
  let command = ''
  let user = ''

  for (const line of output.split('\n')) {
    const tag = line[0]
    const value = line.slice(1)
    if (!tag) continue

    if (tag === 'p') {
      pid = Number.parseInt(value, 10) || 0
      continue
    }
    if (tag === 'c') {
      command = value
      continue
    }
    if (tag === 'L' || tag === 'u') {
      if (tag === 'L') user = value
      continue
    }
    if (tag !== 'n') continue

    // Address forms: "127.0.0.1:3000", "*:8080", "[::1]:5173"
    const match = /^(.*):(\d+)$/.exec(value)
    const portText = match?.[2]
    if (!portText) continue

    const port = Number.parseInt(portText, 10)
    if (!Number.isInteger(port) || port <= 0) continue

    // One process can bind the same port on both IPv4 and IPv6; that is one
    // server as far as the user is concerned.
    const key = `${pid}:${port}`
    if (seen.has(key)) continue
    seen.add(key)

    listeners.push({
      port,
      pid,
      command,
      address: (match?.[1] ?? '').replace(/^\[|\]$/g, '') || '*',
      user
    })
  }

  return listeners.sort((a, b) => a.port - b.port)
}
