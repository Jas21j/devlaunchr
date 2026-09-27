import type { Listener } from './ports'
import { belongsTo, listeners, processTable } from './processTable'

/**
 * Who is actually serving a port, and whether it is the project we started.
 *
 * The question is not "is anything of ours listening on this port". On macOS a
 * port can be held by several sockets at once — one bound to 127.0.0.1,
 * another to 0.0.0.0 or ::1 — and a connection goes to the most specific
 * match. A project can therefore be listening on its port and still have its
 * preview show another project's site. Anything short of "every listener on
 * this port is ours" is treated as a conflict.
 */
export type Verdict =
  /** Every listener on the port belongs to our process tree. */
  | 'ours'
  /** Ours and someone else's, on different addresses. Never previewable. */
  | 'shared'
  /** Only someone else is listening. */
  | 'foreign'
  /** Nothing is listening (or the OS would not tell us). */
  | 'none'

export interface Ownership {
  verdict: Verdict
  /** Where the preview should connect, derived from our own socket's address. */
  host: string | null
  ours: Listener[]
  foreign: Listener[]
}

/** The address a browser should use to reach a socket bound to `address`. */
export function previewHost(address: string): string {
  if (address === '::1') return '[::1]'
  // A wildcard bind answers on the IPv4 loopback; so does an explicit one.
  return '127.0.0.1'
}

export async function resolveOwnership(
  port: number,
  rootPid: number | null | undefined,
  options: { fresh?: boolean } = {}
): Promise<Ownership> {
  const all = (await listeners(options.fresh ? 0 : undefined)).filter((entry) => entry.port === port)
  if (all.length === 0) return { verdict: 'none', host: null, ours: [], foreign: [] }

  const table = rootPid ? await processTable(options.fresh ? 0 : undefined) : new Map()
  const ours: Listener[] = []
  const foreign: Listener[] = []
  for (const entry of all) {
    if (rootPid && belongsTo(entry.pid, rootPid, table)) ours.push(entry)
    else foreign.push(entry)
  }

  const verdict: Verdict =
    ours.length > 0 && foreign.length > 0 ? 'shared' : ours.length > 0 ? 'ours' : 'foreign'

  // Prefer the address our server bound explicitly; fall back to loopback.
  const ownSocket = ours.find((entry) => entry.address === '127.0.0.1')
    ?? ours.find((entry) => entry.address === '::1')
    ?? ours[0]
  return { verdict, host: ownSocket ? previewHost(ownSocket.address) : null, ours, foreign }
}

/** A readable name for whoever holds a port, for error messages. */
export function describeHolder(entry: Pick<Listener, 'command' | 'pid'> | undefined): string {
  return entry ? `${entry.command || 'a process'} (pid ${entry.pid})` : 'another process'
}
