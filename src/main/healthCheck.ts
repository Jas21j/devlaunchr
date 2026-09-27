import { connect } from 'node:net'
import { request } from 'node:http'

const POLL_INTERVAL_MS = 400

/** Dev servers bind one or the other, and which one is not predictable. */
const HOSTS = ['127.0.0.1', '::1'] as const

function tcpReachable(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (result: boolean): void => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Any HTTP response counts as healthy — 301, 404, and 500 all prove a server
 * is listening and speaking HTTP. Only a refused connection means "not up".
 */
function httpResponds(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      { host, port, path: '/', method: 'GET', timeout: timeoutMs },
      (response) => {
        response.resume()
        resolve(response.statusCode !== undefined)
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    // A server that accepts TCP but speaks a non-HTTP protocol still counts as
    // alive; the tab just will not render.
    req.on('error', () => resolve(false))
    req.end()
  })
}

export interface HealthResult {
  ok: boolean
  host: string | null
  reason: 'healthy' | 'timeout' | 'exited' | 'cancelled' | 'foreign'
  /** The port that was being checked when the result was decided. */
  port: number | null
  /** False when the OS could not tell us who owns the port (no lsof, say). */
  verified: boolean
}

export interface OwnershipCheck {
  verdict: 'ours' | 'shared' | 'foreign' | 'none'
  host: string | null
}

export interface HealthOptions {
  /**
   * Read fresh on every poll: the child may announce a different port in its
   * output mid-startup, and the check must follow it rather than waiting out
   * the timeout on a port nothing will ever bind.
   */
  getPort: () => number
  timeoutMs: number
  /** False once the child process has exited — lets us fail fast. */
  isAlive: () => boolean
  signal: { cancelled: boolean }
  /**
   * Who is actually serving the port. A response alone proves nothing: on
   * macOS another project can be answering on the same port from a more
   * specific address. Only "ours" counts as healthy.
   */
  verify?: (port: number) => Promise<OwnershipCheck>
  /**
   * How long someone else may answer before it is reported as a conflict. A
   * dev server that finds its port taken usually moves to another one within
   * a second or two, and that move should be followed rather than failed.
   */
  foreignGraceMs?: number
}

export async function waitForHealthy({
  getPort,
  timeoutMs,
  isAlive,
  signal,
  verify,
  foreignGraceMs = 6000
}: HealthOptions): Promise<HealthResult> {
  const deadline = Date.now() + timeoutMs
  let foreignSince: number | null = null
  let foreignPort: number | null = null

  while (Date.now() < deadline) {
    if (signal.cancelled) return { ok: false, host: null, reason: 'cancelled', port: null, verified: false }
    if (!isAlive()) return { ok: false, host: null, reason: 'exited', port: null, verified: false }

    const port = getPort()
    let reached: string | null = null
    for (const host of HOSTS) {
      if (await tcpReachable(host, port)) {
        reached = host
        break
      }
    }

    if (reached) {
      if (!verify) {
        await httpResponds(reached, port)
        return { ok: true, host: reached, reason: 'healthy', port, verified: false }
      }

      const check = await verify(port)
      if (check.verdict === 'ours' || check.verdict === 'none') {
        // TCP first, HTTP second: this avoids sending an HTTP request to a
        // database or websocket server that happens to hold the port.
        const host = check.host ? check.host.replace(/^\[|\]$/g, '') : reached
        await httpResponds(host, port)
        return { ok: true, host, reason: 'healthy', port, verified: check.verdict === 'ours' }
      }

      // Our server and a stranger's on one port, on different addresses. No
      // amount of waiting separates them.
      if (check.verdict === 'shared') {
        return { ok: false, host: null, reason: 'foreign', port, verified: true }
      }

      // Only someone else is answering on this port. Give our child a moment
      // to either take it properly or move elsewhere and say so.
      if (foreignPort !== port) {
        foreignPort = port
        foreignSince = Date.now()
      } else if (foreignSince !== null && Date.now() - foreignSince > foreignGraceMs) {
        return { ok: false, host: null, reason: 'foreign', port, verified: true }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  return { ok: false, host: null, reason: isAlive() ? 'timeout' : 'exited', port: getPort(), verified: false }
}

/**
 * Frameworks routinely ignore $PORT. Whatever the child prints wins over
 * whatever we assigned it.
 */
const PORT_PATTERNS = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i,
  /Local:\s+https?:\/\/\S+?:(\d{2,5})/i,
  /listening on (?:port )?(\d{2,5})/i,
  /server (?:running|started) (?:on|at) .*?:(\d{2,5})/i,
  /port[:= ]+(\d{2,5})\b/i
]

/** The bare word "port" is only trusted on a line that reads like a server announcing itself. */
const SERVERISH = /\b(listen|listening|serv(?:er|ing)|ready|running|started|local)\b/i

export function parsePort(text: string): number | null {
  for (const [index, pattern] of PORT_PATTERNS.entries()) {
    if (index === PORT_PATTERNS.length - 1 && !SERVERISH.test(text)) continue
    const match = pattern.exec(text)
    const value = match?.[1]
    if (!value) continue
    const port = Number.parseInt(value, 10)
    if (port >= 1 && port <= 65535) return port
  }
  return null
}
