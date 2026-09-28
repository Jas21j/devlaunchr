import type { ProjectType } from '@shared/types'

export const TYPE_LABELS: Record<ProjectType, string> = {
  'node-vite': 'Vite',
  'node-next': 'Next.js',
  'node-generic': 'Node',
  'python-django': 'Django',
  'python-flask': 'Flask',
  'python-generic': 'Python',
  php: 'PHP',
  static: 'Static',
  'docker-compose': 'Compose',
  custom: 'Custom'
}

export const TYPE_ORDER: ProjectType[] = [
  'node-vite',
  'node-next',
  'node-generic',
  'python-django',
  'python-flask',
  'python-generic',
  'php',
  'static',
  'docker-compose',
  'custom'
]

/** Collapses a home-relative path for display: /Users/x/Desktop/a → ~/Desktop/a */
export function tildePath(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/**
 * Folder names repeat constantly across a real machine — three projects named
 * `site`, two named `web`. Rows that collide get their parent folder prefixed
 * so the list stays unambiguous, while unique names stay short.
 */
export function disambiguate<T extends { id: string; name: string; path: string }>(
  items: T[]
): Map<string, string> {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  }

  const labels = new Map<string, string>()
  for (const item of items) {
    if ((counts.get(item.name) ?? 0) < 2) {
      labels.set(item.id, item.name)
      continue
    }
    // Both separators: a Windows path has no forward slashes at all.
    const segments = item.path.split(/[\\/]/).filter(Boolean)
    const parent = segments[segments.length - 2]
    labels.set(item.id, parent ? `${parent}/${item.name}` : item.name)
  }
  return labels
}

/** Words and symbols that differ by platform, so copy never says "Mac" on Windows. */
export interface PlatformCopy {
  isMac: boolean
  /** "this Mac", "this PC", "this computer" */
  computer: string
  fileManager: string
  /** The shortcut modifier as it is printed: ⌘ or Ctrl. */
  mod: string
}

export function platformCopy(platform: string | undefined): PlatformCopy {
  if (platform === 'darwin') {
    return { isMac: true, computer: 'this Mac', fileManager: 'Finder', mod: '⌘' }
  }
  if (platform === 'win32') {
    return { isMac: false, computer: 'this PC', fileManager: 'File Explorer', mod: 'Ctrl' }
  }
  return { isMac: false, computer: 'this computer', fileManager: 'Files', mod: 'Ctrl' }
}

export const plural = (count: number, word: string, many = `${word}s`): string =>
  `${count} ${count === 1 ? word : many}`
