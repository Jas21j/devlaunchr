/**
 * Minimal PNG read/write for build-time image work.
 *
 * Handles 8-bit RGB/RGBA, non-interlaced — which is what every export from a
 * design tool produces. Written against node:zlib so the build carries no
 * image dependency.
 */
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Returns { width, height, pixels } with pixels as RGBA bytes. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file')

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset += 12 + length
  }

  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`Unsupported colour type ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  const previous = Buffer.alloc(stride)
  const current = Buffer.alloc(stride)

  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    raw.copy(current, 0, pos, pos + stride)
    pos += stride

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? current[i - channels] : 0
      const b = previous[i]
      const c = i >= channels ? previous[i - channels] : 0

      switch (filter) {
        case 0: break
        case 1: current[i] = (current[i] + a) & 0xff; break
        case 2: current[i] = (current[i] + b) & 0xff; break
        case 3: current[i] = (current[i] + ((a + b) >> 1)) & 0xff; break
        case 4: current[i] = (current[i] + paeth(a, b, c)) & 0xff; break
        default: throw new Error(`Unknown filter ${filter}`)
      }
    }

    for (let x = 0; x < width; x++) {
      const src = x * channels
      const dst = (y * width + x) * 4
      out[dst] = current[src]
      out[dst + 1] = current[src + 1]
      out[dst + 2] = current[src + 2]
      out[dst + 3] = channels === 4 ? current[src + 3] : 255
    }

    current.copy(previous)
  }

  return { width, height, pixels: out }
}

export function encodePng({ width, height, pixels }) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Bilinear resample. Good enough for downscaling artwork to icon sizes. */
export function resize(image, targetWidth, targetHeight) {
  const { width, height, pixels } = image
  const out = Buffer.alloc(targetWidth * targetHeight * 4)
  const xRatio = width / targetWidth
  const yRatio = height / targetHeight

  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(height - 1, (y + 0.5) * yRatio - 0.5)
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(height - 1, y0 + 1)
    const wy = sy - y0

    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(width - 1, (x + 0.5) * xRatio - 0.5)
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(width - 1, x0 + 1)
      const wx = sx - x0

      const dst = (y * targetWidth + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        const p00 = pixels[(y0 * width + x0) * 4 + channel]
        const p10 = pixels[(y0 * width + x1) * 4 + channel]
        const p01 = pixels[(y1 * width + x0) * 4 + channel]
        const p11 = pixels[(y1 * width + x1) * 4 + channel]
        const top = p00 + (p10 - p00) * wx
        const bottom = p01 + (p11 - p01) * wx
        out[dst + channel] = Math.round(top + (bottom - top) * wy)
      }
    }
  }

  return { width: targetWidth, height: targetHeight, pixels: out }
}

/** Bounding box of pixels that are not fully transparent. */
export function alphaBounds(image, threshold = 8) {
  const { width, height, pixels } = image
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= threshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) return { x: 0, y: 0, width, height }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export function crop(image, { x, y, width, height }) {
  const out = Buffer.alloc(width * height * 4)
  for (let row = 0; row < height; row++) {
    const src = ((y + row) * image.width + x) * 4
    image.pixels.copy(out, row * width * 4, src, src + width * 4)
  }
  return { width, height, pixels: out }
}
