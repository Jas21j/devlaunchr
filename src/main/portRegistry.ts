import { connect, createServer } from 'node:net'
import type { Listener } from './ports'
import { listeners } from './processTable'

const reserved = new Map<number, string>()

/**
 * Allocation is serialized through this chain. Two projects started in the
 * same tick would otherwise both probe the same port as free — the bind test
 * releases the socket immediately, so "free" is only true until someone acts
 * on it.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

type Probe = 'free' | 'taken' | 'unsupported'

function bindProbe(port: number, host: string): Promise<Probe> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', (error: NodeJS.ErrnoException) => {
      // A machine without IPv6 cannot bind ::1 at all; that says nothing
      // about whether the port is taken.
      resolve(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT' ? 'unsupported' : 'taken')
    })
    server.once('listening', () => server.close(() => resolve('free')))
    try {
      server.listen({ port, host, ipv6Only: host === '::' })
    } catch {
      resolve('taken')
    }
  })
}

function answers(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (value: boolean): void => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(400)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Whether a port is genuinely free for a new project to own.
 *
 * Binding the wildcard address is not enough. With SO_REUSEADDR, which Node
 * sets, macOS lets a wildcard bind succeed while another process is listening
 * on 127.0.0.1 or ::1 on the same port, and connections to localhost keep
 * going to that other process. So a port is free only when:
 *
 *   1. the OS lists no listener on it at any address,
 *   2. nothing answers on either loopback address, and
 *   3. binding 127.0.0.1, ::1, 0.0.0.0 and :: each succeeds.
 *
 * `snapshot` lets a caller that checks many ports share one listener lookup.
 */
export async function isPortFree(port: number, snapshot?: readonly Listener[]): Promise<boolean> {
  const list = snapshot ?? (await listeners())
  if (list.some((entry) => entry.port === port)) return false
  if ((await answers('127.0.0.1', port)) || (await answers('::1', port))) return false
  for (const host of ['127.0.0.1', '::1', '0.0.0.0', '::']) {
    if ((await bindProbe(port, host)) === 'taken') return false
  }
  return true
}

export class NoFreePortError extends Error {
  constructor(start: number, end: number) {
    super(`No free port between ${start} and ${end}.`)
    this.name = 'NoFreePortError'
  }
}

export function allocate(
  projectId: string,
  preferred: number | null,
  rangeStart: number,
  rangeEnd: number
): Promise<number> {
  return serialize(async () => {
    const take = (port: number): number => {
      reserved.set(port, projectId)
      return port
    }

    // One listener lookup for the whole scan, not one per candidate port.
    const snapshot = await listeners(0)
    const held = new Set(snapshot.map((entry) => entry.port))

    if (preferred !== null && !reserved.has(preferred) && !held.has(preferred) && (await isPortFree(preferred, snapshot))) {
      return take(preferred)
    }

    for (let port = rangeStart; port <= rangeEnd; port++) {
      if (reserved.has(port) || held.has(port)) continue
      if (await isPortFree(port, snapshot)) return take(port)
    }

    throw new NoFreePortError(rangeStart, rangeEnd)
  })
}

/**
 * Claims a port the child chose for itself, parsed out of its log output. The
 * assigned port is released in the same move, since the child never used it.
 */
export function claim(projectId: string, port: number, previous: number | null): void {
  if (previous !== null && previous !== port && reserved.get(previous) === projectId) {
    reserved.delete(previous)
  }
  reserved.set(port, projectId)
}

export function release(projectId: string): void {
  for (const [port, owner] of reserved) {
    if (owner === projectId) reserved.delete(port)
  }
}

export const reservations = (): ReadonlyMap<number, string> => reserved

/** Which project, if any, has already been handed this port this session. */
export const ownerOf = (port: number): string | undefined => reserved.get(port)
