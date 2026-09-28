import { spawn } from 'node:child_process'
import type { EditorId, Settings } from '@shared/types'
import { IS_MAC, shellFor, shellQuote } from './platform'
import { cachedPath } from './pathResolver'

interface KnownEditor {
  label: string
  /** The command-line launcher each editor installs onto PATH. */
  cli: string
  /** The macOS application name, used when the launcher is not on PATH. */
  macApp: string
}

export const EDITORS: Record<Exclude<EditorId, 'custom'>, KnownEditor> = {
  vscode: { label: 'VS Code', cli: 'code', macApp: 'Visual Studio Code' },
  cursor: { label: 'Cursor', cli: 'cursor', macApp: 'Cursor' },
  zed: { label: 'Zed', cli: 'zed', macApp: 'Zed' },
  sublime: { label: 'Sublime Text', cli: 'subl', macApp: 'Sublime Text' }
}

/**
 * The shell command that opens `path` in the chosen editor.
 *
 * A custom command may place the folder with `{path}`; without the
 * placeholder the folder is appended, which is what every editor launcher
 * expects. Returns null when a custom editor was chosen but never configured.
 */
export function editorCommand(settings: Pick<Settings, 'editor' | 'editorCustomCommand'>, path: string): string | null {
  const quoted = shellQuote(path)
  if (settings.editor === 'custom') {
    const template = settings.editorCustomCommand.trim()
    if (!template) return null
    return template.includes('{path}') ? template.split('{path}').join(quoted) : `${template} ${quoted}`
  }
  return `${EDITORS[settings.editor].cli} ${quoted}`
}

export const editorLabel = (settings: Pick<Settings, 'editor'>): string =>
  settings.editor === 'custom' ? 'your editor' : EDITORS[settings.editor].label

/**
 * Runs a launcher command and reports whether it worked.
 *
 * Editor launchers hand off to the running app and exit almost at once, so a
 * non-zero exit is a real failure (usually "command not found"). A command
 * still running after a few seconds is a GUI app that stayed attached, which
 * is also success — it is detached and left alone.
 */
function run(command: string): Promise<boolean> {
  const { file, args } = shellFor(command)
  const path = cachedPath()
  return new Promise((resolve) => {
    try {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: path ? { ...process.env, PATH: path } : process.env
      })
      const timer = setTimeout(() => {
        child.unref()
        resolve(true)
      }, 4000)
      child.once('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })
    } catch {
      resolve(false)
    }
  })
}

export type EditorResult = { ok: true } | { ok: false; message: string }

export async function openInEditor(settings: Settings, path: string): Promise<EditorResult> {
  const command = editorCommand(settings, path)
  if (!command) {
    return { ok: false, message: 'Custom editor is selected but has no command. Set one in Settings → Editor.' }
  }

  if (await run(command)) return { ok: true }

  // The launcher is often simply not on PATH on a Mac (VS Code only installs
  // `code` when asked to), but the app itself is still there to open.
  if (IS_MAC && settings.editor !== 'custom') {
    const app = EDITORS[settings.editor].macApp
    if (await run(`open -a ${shellQuote(app)} ${shellQuote(path)}`)) return { ok: true }
  }

  if (settings.editor === 'custom') {
    return { ok: false, message: `Your editor command failed: ${command}` }
  }
  const editor = EDITORS[settings.editor]
  return {
    ok: false,
    message: `${editor.label} could not be opened. Install it, or put its \`${editor.cli}\` command on your PATH, or choose another editor in Settings.`
  }
}
