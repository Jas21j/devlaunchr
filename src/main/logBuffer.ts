import type { LogLine } from '@shared/types'

const MAX_LINES = 2000
const MAX_LINE_CHARS = 2000
const MAX_TOTAL_CHARS = 2_000_000

/**
 * Fixed-capacity log store for one project.
 *
 * Capped by characters as well as by line count: a single inline sourcemap or
 * base64 payload can be hundreds of kilobytes on one line, so a 2000-line cap
 * alone does not bound memory.
 */
export class LogBuffer {
  private lines: LogLine[] = []
  private chars = 0

  push(stream: LogLine['stream'], text: string): LogLine {
    const clipped =
      text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)} … (${text.length} chars)` : text

    const line: LogLine = { ts: Date.now(), stream, text: clipped }
    this.lines.push(line)
    this.chars += clipped.length

    while (this.lines.length > MAX_LINES || this.chars > MAX_TOTAL_CHARS) {
      const dropped = this.lines.shift()
      if (!dropped) break
      this.chars -= dropped.text.length
    }

    return line
  }

  all(): LogLine[] {
    return this.lines
  }

  clear(): void {
    this.lines = []
    this.chars = 0
  }
}

/**
 * Splits a stream chunk into whole lines, holding a trailing partial line
 * until the rest of it arrives. Without this, a line straddling two chunk
 * boundaries is reported as two broken lines.
 */
export class LineSplitter {
  private partial = ''

  push(chunk: string): string[] {
    const combined = this.partial + chunk
    const parts = combined.split(/\r?\n/)
    this.partial = parts.pop() ?? ''

    // A progress bar that rewrites itself with \r would otherwise never flush.
    if (this.partial.length > MAX_LINE_CHARS) {
      parts.push(this.partial)
      this.partial = ''
    }
    return parts
  }

  flush(): string[] {
    if (!this.partial) return []
    const rest = this.partial
    this.partial = ''
    return [rest]
  }
}
