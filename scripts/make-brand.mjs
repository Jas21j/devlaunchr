#!/usr/bin/env node
/**
 * Builds every brand asset from one source logo, brand/logo-mark.png.
 *
 *   resources/icon.png / icon.icns   the mark on an obsidian squircle —
 *                                    application and Dock icon
 *   src/renderer/assets/favicon.png  the bare mark, no squircle
 *   src/renderer/assets/mark.png     an alpha-only silhouette, used as a CSS
 *                                    mask so the in-app mark takes the
 *                                    current theme's ink colour
 *
 * Run with: npm run brand
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, resize, alphaBounds, crop } from './lib/png.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 1024

const SOURCE = resolve(ROOT, 'brand/logo-mark.png')

const OBSIDIAN = [0x09, 0x09, 0x0b]

/** Superellipse — the Apple squircle at n ≈ 5. */
const inSquircle = (x, y, cx, cy, a, n = 5) =>
  Math.abs((x - cx) / a) ** n + Math.abs((y - cy) / a) ** n <= 1

// ---------------------------------------------------------------- app icon

function buildIcon() {
  const source = decodePng(readFileSync(SOURCE))

  // Trim the transparent margin so the mark fills a predictable box.
  const trimmed = crop(source, alphaBounds(source, 12))

  // The mark is roughly 1.8:1, so it is fitted by width rather than by its
  // longest side: 74% of the canvas keeps it clear of the squircle's corners
  // while still filling the icon at 16px, where a timid mark disappears.
  const target = Math.round(SIZE * 0.74)
  const scale = target / trimmed.width
  const logo = resize(trimmed, Math.round(trimmed.width * scale), Math.round(trimmed.height * scale))

  const canvas = Buffer.alloc(SIZE * SIZE * 4)
  const SS = 3
  const step = 1 / SS
  const offset = step / 2

  // Anti-aliased squircle, supersampled because a hard edge on a 1024px
  // rounded shape is visible even at Dock size.
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inSquircle(px + offset + sx * step, py + offset + sy * step, SIZE / 2, SIZE / 2, 416)) {
            hits++
          }
        }
      }
      if (hits === 0) continue
      const i = (py * SIZE + px) * 4
      canvas[i] = OBSIDIAN[0]
      canvas[i + 1] = OBSIDIAN[1]
      canvas[i + 2] = OBSIDIAN[2]
      canvas[i + 3] = Math.round((hits / (SS * SS)) * 255)
    }
  }

  const originX = Math.round((SIZE - logo.width) / 2)
  const originY = Math.round((SIZE - logo.height) / 2)

  /**
   * The source art draws the pixel "D" as opaque near-black strokes, legible
   * only because a neon halo surrounds it. On a dark squircle that halo is not
   * enough and the D vanishes, so its strokes are lifted to zinc here.
   *
   * This is a legibility fix, not a redesign: only pixels that are both opaque
   * and essentially black are touched, which is exactly the D. Every glowing
   * element keeps its original colour.
   */
  const SOLID_ALPHA = 200
  const NEAR_BLACK = 60
  const LIFTED = [0xd4, 0xd4, 0xd8]

  for (let y = 0; y < logo.height; y++) {
    for (let x = 0; x < logo.width; x++) {
      const src = (y * logo.width + x) * 4
      const rawAlpha = logo.pixels[src + 3]
      if (rawAlpha === 0) continue

      const canvasX = originX + x
      const canvasY = originY + y
      if (canvasX < 0 || canvasY < 0 || canvasX >= SIZE || canvasY >= SIZE) continue

      const dst = (canvasY * SIZE + canvasX) * 4
      const alpha = rawAlpha / 255

      let rgb = [logo.pixels[src], logo.pixels[src + 1], logo.pixels[src + 2]]
      if (rawAlpha >= SOLID_ALPHA && rgb[0] + rgb[1] + rgb[2] < NEAR_BLACK) rgb = LIFTED

      for (let channel = 0; channel < 3; channel++) {
        canvas[dst + channel] = Math.round(
          rgb[channel] * alpha + canvas[dst + channel] * (1 - alpha)
        )
      }
      canvas[dst + 3] = Math.max(canvas[dst + 3], rawAlpha)
    }
  }

  const pngPath = resolve(ROOT, 'resources/icon.png')
  mkdirSync(resolve(ROOT, 'resources'), { recursive: true })
  writeFileSync(pngPath, encodePng({ width: SIZE, height: SIZE, pixels: canvas }))

  // Linux uses the PNG directly and electron-builder derives the Windows .ico
  // from it, so the 1024px master is the only asset that must always exist.
  // The .icns needs Apple's own tools, so it is built on macOS and skipped
  // elsewhere; a Linux or Windows runner never builds the mac target.
  if (process.platform !== 'darwin') {
    console.log('wrote resources/icon.png and assets/favicon.png (.icns skipped: macOS only)')
    return
  }

  const iconset = resolve(ROOT, 'resources/icon.iconset')
  mkdirSync(iconset, { recursive: true })
  for (const [size, scaleFactor] of [
    [16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2],
    [256, 1], [256, 2], [512, 1], [512, 2]
  ]) {
    const px = size * scaleFactor
    const name = scaleFactor === 2 ? `icon_${size}x${size}@2x.png` : `icon_${size}x${size}.png`
    execFileSync('sips', ['-z', String(px), String(px), pngPath, '--out', resolve(iconset, name)], {
      stdio: 'ignore'
    })
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', resolve(ROOT, 'resources/icon.icns')])
  rmSync(iconset, { recursive: true, force: true })

  // The renderer's <link rel="icon"> reuses the finished icon: the bare mark's
  // black D is invisible against an unknown background, the squircle is not.
  const favicon = resize({ width: SIZE, height: SIZE, pixels: canvas }, 256, 256)
  const faviconPath = resolve(ROOT, 'src/renderer/assets/favicon.png')
  mkdirSync(dirname(faviconPath), { recursive: true })
  writeFileSync(faviconPath, encodePng(favicon))

  console.log('wrote resources/icon.png, resources/icon.icns, and assets/favicon.png')
}

// -------------------------------------------------------------- in-app mark

/**
 * The mark's own alpha channel is the silhouette. Flattening the colour to
 * white and keeping the alpha gives an asset CSS can use as a mask and paint
 * in whatever the current theme's ink colour is — one file that is correct in
 * both light and dark, which a coloured logo could never be.
 */
function buildMark() {
  const source = decodePng(readFileSync(SOURCE))
  const trimmed = crop(source, alphaBounds(source, 12))

  const flattened = Buffer.alloc(trimmed.width * trimmed.height * 4)
  for (let i = 0; i < trimmed.width * trimmed.height; i++) {
    flattened[i * 4] = 255
    flattened[i * 4 + 1] = 255
    flattened[i * 4 + 2] = 255
    flattened[i * 4 + 3] = trimmed.pixels[i * 4 + 3]
  }

  // Aspect is preserved: the mark is wide, and squaring it would either crop
  // the rocket or leave the logo floating in dead space.
  const width = 320
  const height = Math.round((trimmed.height / trimmed.width) * width)
  const final = resize(
    { width: trimmed.width, height: trimmed.height, pixels: flattened },
    width,
    height
  )

  const out = resolve(ROOT, 'src/renderer/assets/mark.png')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, encodePng(final))

  console.log(`wrote src/renderer/assets/mark.png (${width}x${height})`)
}

buildIcon()
buildMark()
