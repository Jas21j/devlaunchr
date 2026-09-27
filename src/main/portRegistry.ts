import { createServer } from 'node:net'

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

function bindable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    try {
      server.listen({ port, host, ipv6Only: host === '::' })
    } catch {
      resolve(false)
    }
  })
}

/**
 * Binds a throwaway server rather than consulting a table of known ports.
 *
 * Both address families are probed. Binding 0.0.0.0 alone misses a server
 * listening on `::` only, and handing out a port that another process already
 * holds on IPv6 produces an EADDRINUSE the user cannot explain.
 */
export async function isPortFree(port: number): Promise<boolean> {
  if (!(await bindable(port, '0.0.0.0'))) return false
  return bindable(port, '::')
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

    if (preferred !== null && !reserved.has(preferred) && (await isPortFree(preferred))) {
      return take(preferred)
    }

    for (let port = rangeStart; port <= rangeEnd; port++) {
      if (reserved.has(port)) continue
      if (await isPortFree(port)) return take(port)
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
