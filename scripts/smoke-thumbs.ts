/**
 * Verifies that thumbnails are real pixels, not blank frames.
 * Run with: npm run smoke:thumbs
 */
import { app } from 'electron'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodePng } from './lib/png.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'devlaunchr-thumbs-'))
app.setPath('userData', mkdtempSync(join(tmpdir(), 'devlaunchr-thumbs-data-')))

let failures = 0
const check = (label: string, condition: boolean, detail = ''): void => {
  if (!condition) failures++
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#0b7a34; font-family:system-ui; }
  .box { position:absolute; top:120px; left:160px; width:420px; height:260px; background:#ff5a00; }
  h1 { position:absolute; top:420px; left:160px; color:#fff; font-size:64px; }
</style></head><body><div class="box"></div><h1>Thumbnail test</h1></body></html>`

/** Counts distinct colours — a blank capture has one. */
function distinctColours(buffer: Buffer): number {
  const { width, height, pixels } = decodePng(buffer)
  const seen = new Set<number>()
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4
      seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
    }
  }
  return seen.size
}

void app.whenReady().then(async () => {
  const thumbs = await import('../src/main/thumbnails')

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(PAGE)
  })
  await new Promise<void>((resolve) => server.listen(3911, '127.0.0.1', resolve))

  // ----------------------------------------------------------- capture
  const captured = await thumbs.capture('proj-capture', 'http://127.0.0.1:3911/')
  check('capture reports success', captured)

  const info = thumbs.get('proj-capture')
  check('thumbnail is registered', info !== null)
  check('url uses the custom scheme', info?.url.startsWith('devlaunchr-thumb://') ?? false, info?.url)
  check('url carries a cache-busting version', /\?v=\d+$/.test(info?.url ?? ''))
  check('recorded as a screenshot, not a disk image', info?.fromDisk === false)

  const file = join(app.getPath('userData'), 'thumbnails', 'proj-capture.png')
  check('png was written', existsSync(file))

  if (existsSync(file)) {
    const buffer = readFileSync(file)
    const image = decodePng(buffer)
    check('stored at the downscaled width', image.width === 640, `${image.width}x${image.height}`)
    const colours = distinctColours(buffer)
    check('capture contains real pixels, not a blank frame', colours > 3, `${colours} distinct colours`)
    check('file is a sane size', buffer.length > 2000, `${buffer.length} bytes`)
  }

  // ------------------------------------------------- recapture throttle
  // Kept for the provenance checks below, which delete the original.
  const file2 = file
  const skipped = await thumbs.capture('proj-capture', 'http://127.0.0.1:3911/')
  check('recapture inside the cooldown is skipped', skipped === false)
  const forced = await thumbs.capture('proj-capture', 'http://127.0.0.1:3911/', { force: true })
  check('forced recapture runs anyway', forced === true)

  // ------------------------------------------------------ unreachable
  const dead = await thumbs.capture('proj-dead', 'http://127.0.0.1:3912/')
  check('a dead server fails cleanly rather than throwing', dead === false)
  check('no thumbnail is written for a failed capture', thumbs.get('proj-dead') === null)

  // -------------------------------------------------------- disk seed
  const projectRoot = join(scratch, 'with-og')
  mkdirSync(join(projectRoot, 'public'), { recursive: true })
  // Reuse a real PNG: the one we just captured.
  writeFileSync(join(projectRoot, 'public', 'og-image.png'), readFileSync(file))

  check('seeds a preview from public/og-image.png', thumbs.seedFromDisk('proj-disk', projectRoot))
  check('disk seed is flagged as such', thumbs.get('proj-disk')?.fromDisk === true)
  check(
    'seeding does not overwrite an existing capture',
    thumbs.seedFromDisk('proj-capture', projectRoot) === false
  )

  const bare = join(scratch, 'bare')
  mkdirSync(bare, { recursive: true })
  check('a project with no images seeds nothing', thumbs.seedFromDisk('proj-bare', bare) === false)

  // Tiny images are icons, not previews.
  const tiny = join(scratch, 'tiny')
  mkdirSync(join(tiny, 'public'), { recursive: true })
  writeFileSync(join(tiny, 'public', 'icon.png'), Buffer.alloc(900, 1))
  check('a sub-8KB image is ignored', thumbs.findPreviewOnDisk(tiny) === null)

  // ------------------------------------------------- verifying provenance
  check('a capture records where it came from',
    thumbs.get('proj-capture')?.capturedFrom === 'http://127.0.0.1:3911/',
    thumbs.get('proj-capture')?.capturedFrom ?? 'null')

  // An image taken from a different address is not this project's site.
  const staleDropped = thumbs.discardUnverified(
    new Map([['proj-capture', 'http://127.0.0.1:9999/']])
  )
  check('an image captured from another address is discarded',
    staleDropped.includes('proj-capture'))
  check('and the file is gone', thumbs.get('proj-capture') === null)

  // Disk-sourced artwork has no origin and must survive.
  check('a disk preview is kept', thumbs.seedFromDisk('proj-keep', projectRoot))
  const keptDropped = thumbs.discardUnverified(new Map([['proj-keep', 'http://127.0.0.1:1/']]))
  check('a disk preview is never discarded for a url mismatch',
    !keptDropped.includes('proj-keep'))
  check('it is still there', thumbs.get('proj-keep') !== null)

  // An image with no metadata predates provenance tracking and is unverifiable.
  writeFileSync(join(app.getPath('userData'), 'thumbnails', 'proj-legacy.png'), readFileSync(file2))
  const legacyDropped = thumbs.discardUnverified(new Map([['proj-legacy', null]]))
  check('an image with no recorded origin is discarded', legacyDropped.includes('proj-legacy'))

  // ------------------------------------------------------------ forget
  thumbs.forget('proj-disk')
  check('forget removes the cached file', thumbs.get('proj-disk') === null)

  // ------------------------------------------------------------- list
  const listed = thumbs.all(['proj-capture', 'proj-dead', 'proj-disk'])
  check('all() returns only projects that have one', listed.length === 1, `${listed.length}`)

  const mtime = statSync(file).mtimeMs
  check('capturedAt matches the file mtime', Math.abs((thumbs.get('proj-capture')?.capturedAt ?? 0) - mtime) < 2)

  server.close()
  console.log(failures === 0 ? '\nall thumbnail checks passed' : `\n${failures} check(s) failed`)
  app.exit(failures === 0 ? 0 : 1)
})
