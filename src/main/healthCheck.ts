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
  reason: 'healthy' | 'timeout' | 'exited' | 'cancelled'
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
}

export async function waitForHealthy({
  getPort,
  timeoutMs,
  isAlive,
  signal
}: HealthOptions): Promise<HealthResult> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (signal.cancelled) return { ok: false, host: null, reason: 'cancelled' }
    if (!isAlive()) return { ok: false, host: null, reason: 'exited' }

    const port = getPort()
    for (const host of HOSTS) {
      if (!(await tcpReachable(host, port))) continue
      // TCP first, HTTP second: this avoids sending an HTTP request to a
      // database or websocket server that happens to hold the port.
      await httpResponds(host, port)
      return { ok: true, host, reason: 'healthy' }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  return { ok: false, host: null, reason: isAlive() ? 'timeout' : 'exited' }
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

export function parsePort(text: string): number | null {
  for (const pattern of PORT_PATTERNS) {
    const match = pattern.exec(text)
    const value = match?.[1]
    if (!value) continue
    const port = Number.parseInt(value, 10)
    if (port >= 1 && port <= 65535) return port
  }
  return null
}
