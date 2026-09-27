import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync
} from 'node:fs'
import { join, extname } from 'node:path'
import { EventEmitter } from 'node:events'
import { app, BrowserWindow, nativeImage, protocol, net } from 'electron'

export const events = new EventEmitter()

const WIDTH = 1280
const HEIGHT = 800
const STORED_WIDTH = 640

/** How long a capture may take before it is abandoned. */
const CAPTURE_TIMEOUT_MS = 12_000
/** A page gets this long after load to run its own scripts and settle. */
const SETTLE_MS = 1400
/** A fresh screenshot is not worth re-taking more often than this. */
const MIN_RECAPTURE_MS = 60_000

export const SCHEME = 'devlaunchr-thumb'

const dir = (): string => {
  const path = join(app.getPath('userData'), 'thumbnails')
  mkdirSync(path, { recursive: true })
  return path
}

const fileFor = (projectId: string): string => join(dir(), `${projectId}.png`)
const metaFor = (projectId: string): string => join(dir(), `${projectId}.json`)

/**
 * What a cached image actually shows.
 *
 * Without this there is no way to tell a correct screenshot from one taken of
 * a different project that happened to be on the same port — both are just a
 * PNG on disk. Recording the origin makes a wrong image detectable instead of
 * permanent.
 */
interface ThumbnailMeta {
  projectId: string
  /** The URL the screenshot was taken from, or null for a disk-sourced image. */
  capturedFrom: string | null
  source: 'capture' | 'disk'
  capturedAt: number
}

function readMeta(projectId: string): ThumbnailMeta | null {
  try {
    const file = metaFor(projectId)
    if (!existsSync(file)) return null
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as ThumbnailMeta
  } catch {
    return null
  }
}

function writeMeta(meta: ThumbnailMeta): void {
  try {
    writeFileSync(metaFor(meta.projectId), JSON.stringify(meta, null, 2), 'utf8')
  } catch {
    // An image without metadata is treated as unverifiable, which is safe.
  }
}

export interface ThumbnailInfo {
  projectId: string
  /** Custom-scheme URL the renderer can put straight into an <img>. */
  url: string
  capturedAt: number
  /** True when the image came from a file in the project, not a screenshot. */
  fromDisk: boolean
  /** The address this screenshot was taken from, when it is known. */
  capturedFrom: string | null
}

// ------------------------------------------------------------------ lookup

const fromDiskIds = new Set<string>()

export function get(projectId: string): ThumbnailInfo | null {
  const file = fileFor(projectId)
  if (!existsSync(file)) return null
  const capturedAt = statSync(file).mtimeMs
  const meta = readMeta(projectId)
  return {
    projectId,
    // The timestamp busts the renderer's image cache when we recapture.
    url: `${SCHEME}://${projectId}?v=${Math.round(capturedAt)}`,
    capturedAt,
    fromDisk: meta ? meta.source === 'disk' : fromDiskIds.has(projectId),
    capturedFrom: meta?.capturedFrom ?? null
  }
}

/**
 * Deletes cached images that cannot be shown to be of the right project.
 *
 * Anything captured before devLaunchr recorded an origin is unverifiable, and
 * an unverifiable screenshot is worse than none: a placeholder is honest,
 * while a screenshot of somebody else's site is a confident lie. Images taken
 * from a URL the project no longer serves go too.
 */
export function discardUnverified(expectedUrls: Map<string, string | null>): string[] {
  const dropped: string[] = []

  for (const [projectId, expected] of expectedUrls) {
    if (!existsSync(fileFor(projectId))) continue
    const meta = readMeta(projectId)

    if (!meta) {
      forget(projectId)
      dropped.push(projectId)
      continue
    }
    if (meta.source === 'disk') continue
    if (expected && meta.capturedFrom && meta.capturedFrom !== expected) {
      forget(projectId)
      dropped.push(projectId)
    }
  }

  return dropped
}

export function all(projectIds: string[]): ThumbnailInfo[] {
  return projectIds.map(get).filter((info): info is ThumbnailInfo => info !== null)
}

/**
 * Serves cached thumbnails to the renderer. A custom scheme is used instead of
 * base64 data URLs so that thirty screenshots do not have to cross IPC as
 * megabytes of text on every render.
 */
export function registerProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const projectId = new URL(request.url).hostname
    // The id comes from our own store, but this is a URL, so treat it as input.
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(projectId)) {
      return new Response('bad id', { status: 400 })
    }

    const file = fileFor(projectId)
    if (!existsSync(file)) return new Response('not found', { status: 404 })

    return net.fetch(`file://${file}`, { bypassCustomProtocolHandlers: true })
  })
}

// ------------------------------------------------------------- disk preview

const PREVIEW_CANDIDATES = [
  'public/og-image.png', 'public/og-image.jpg', 'public/og.png', 'public/og.jpg',
  'public/preview.png', 'public/preview.jpg', 'public/screenshot.png',
  'static/og-image.png', 'static/og.png', 'static/preview.png',
  'assets/og-image.png', 'assets/preview.png',
  'screenshot.png', 'screenshot.jpg', 'preview.png', 'preview.jpg',
  'docs/screenshot.png', '.github/preview.png', '.github/screenshot.png'
]

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/**
 * A project that has never been started has no screenshot, but many repos ship
 * an Open Graph image or a README screenshot. Using it means the grid is not a
 * wall of blank cards on first run.
 */
export function findPreviewOnDisk(projectRoot: string): string | null {
  for (const candidate of PREVIEW_CANDIDATES) {
    const file = join(projectRoot, candidate)
    if (existsSync(file)) return file
  }

  // Otherwise the largest image sitting directly in public/ or static/.
  for (const folder of ['public', 'static']) {
    const path = join(projectRoot, folder)
    if (!existsSync(path)) continue
    try {
      const best = readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
        .map((entry) => {
          const file = join(path, entry.name)
          return { file, size: statSync(file).size }
        })
        // Below 8KB it is an icon or a spacer, not a preview.
        .filter((entry) => entry.size > 8192)
        .sort((a, b) => b.size - a.size)[0]
      if (best) return best.file
    } catch {
      // Unreadable folder is simply no preview.
    }
  }

  return null
}

/** Copies a disk image into the cache, downscaled. Returns true if it worked. */
export function seedFromDisk(projectId: string, projectRoot: string): boolean {
  if (existsSync(fileFor(projectId))) return false

  const source = findPreviewOnDisk(projectRoot)
  if (!source) return false

  try {
    const image = nativeImage.createFromBuffer(readFileSync(source))
    if (image.isEmpty()) return false
    writeFileSync(fileFor(projectId), image.resize({ width: STORED_WIDTH }).toPNG())
    fromDiskIds.add(projectId)
    writeMeta({ projectId, capturedFrom: null, source: 'disk', capturedAt: Date.now() })
    events.emit('thumbnail', get(projectId))
    return true
  } catch {
    return false
  }
}

// ----------------------------------------------------------------- capture

/**
 * One reusable hidden window, not a window per capture.
 *
 * Creating and destroying an offscreen BrowserWindow per screenshot crashes
 * the GPU process on macOS after the first cycle. A single long-lived window,
 * with captures serialised through a queue, is both stabler and faster.
 */
let shooter: BrowserWindow | null = null

function getShooter(): BrowserWindow {
  if (shooter && !shooter.isDestroyed()) return shooter

  shooter = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    // A hidden window still paints with this on, which is what makes
    // capturePage() return real pixels instead of a blank frame.
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The window only ever loads local dev servers, but it should still not
      // be able to reach into the app.
      webSecurity: true,
      /*
       * A throwaway, non-persistent partition — note there is no `persist:`
       * prefix.
       *
       * Every local project is served from 127.0.0.1, so projects that reuse a
       * port are the same origin as far as the browser is concerned. On a
       * shared session the capture window would serve a cached page from
       * whichever project used that port first, and one project's screenshot
       * would end up on another project's card.
       */
      partition: 'devlaunchr-capture'
    }
  })

  shooter.on('closed', () => {
    shooter = null
  })

  return shooter
}

/** Captures run one at a time; several projects can come up at once. */
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

export function dispose(): void {
  if (shooter && !shooter.isDestroyed()) shooter.destroy()
  shooter = null
}

/**
 * Screenshots a running project in the hidden window.
 *
 * A separate window is used rather than capturing the visible <webview>
 * because a project should get a thumbnail whether or not its tab is open, and
 * whether or not devLaunchr is the frontmost app.
 */
export function capture(
  projectId: string,
  url: string,
  options: { force?: boolean } = {}
): Promise<boolean> {
  if (!options.force) {
    const existing = get(projectId)
    if (existing && !existing.fromDisk && Date.now() - existing.capturedAt < MIN_RECAPTURE_MS) {
      return Promise.resolve(false)
    }
  }

  return serialize(async () => {
    const window = getShooter()
    const contents = window.webContents

    try {
      // Belt and braces: the partition is already non-persistent, but an
      // in-memory cache entry from the previous capture would still be reused
      // when two projects share a port.
      await contents.session.clearCache().catch(() => undefined)
      await contents.session
        .clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'filesystem', 'serviceworkers', 'cachestorage'] })
        .catch(() => undefined)

      const loaded = new Promise<void>((resolve, reject) => {
        const onFinish = (): void => {
          contents.off('did-fail-load', onFail)
          resolve()
        }
        const onFail = (_event: unknown, code: number, description: string): void => {
          // -3 is ERR_ABORTED, which a redirect produces; the next load settles it.
          if (code === -3) return
          contents.off('did-finish-load', onFinish)
          reject(new Error(description))
        }
        contents.once('did-finish-load', onFinish)
        contents.on('did-fail-load', onFail)
      })

      // Promise.race settles on whichever rejects first, leaving the other
      // rejection unobserved. Claiming it here keeps Node from reporting an
      // unhandled rejection for a failure we already handle.
      loaded.catch(() => undefined)

      const timeout = new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Timed out')), CAPTURE_TIMEOUT_MS)
      )

      await Promise.race([
        window.loadURL(url).then(() => loaded),
        timeout
      ])

      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      if (window.isDestroyed()) return false

      const image = await contents.capturePage()
      if (image.isEmpty()) return false

      writeFileSync(fileFor(projectId), image.resize({ width: STORED_WIDTH }).toPNG())
      fromDiskIds.delete(projectId)
      writeMeta({ projectId, capturedFrom: url, source: 'capture', capturedAt: Date.now() })
      events.emit('thumbnail', get(projectId))
      return true
    } catch {
      return false
    } finally {
      // Leave nothing rendering between captures: a live dev server left
      // loaded here would keep its websocket open and keep rebuilding.
      if (window && !window.isDestroyed()) {
        await window.loadURL('about:blank').catch(() => undefined)
      }
    }
  })
}

export function forget(projectId: string): void {
  fromDiskIds.delete(projectId)
  try {
    rmSync(fileFor(projectId), { force: true })
    rmSync(metaFor(projectId), { force: true })
  } catch {
    // A thumbnail we cannot remove is not worth failing a delete over.
  }
}
