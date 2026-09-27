import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const IS_WINDOWS = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

/**
 * The shell project commands run in.
 *
 * Unix gets the user's login shell where possible, because `source`,
 * `&&`-chained install commands, and virtualenv activation all assume a POSIX
 * shell. Windows gets PowerShell, which is the only shell guaranteed present
 * that can handle the same command strings.
 */
export function shellFor(command: string): { file: string; args: string[] } {
  if (IS_WINDOWS) {
    return {
      file: process.env['COMSPEC']?.toLowerCase().includes('powershell')
        ? process.env['COMSPEC']
        : 'powershell.exe',
      // -NoProfile keeps a user's profile banner out of the parsed output.
      args: ['-NoProfile', '-NonInteractive', '-Command', command]
    }
  }

  const candidates = [process.env['SHELL'], '/bin/zsh', '/bin/bash', '/bin/sh'].filter(
    (path): path is string => typeof path === 'string' && path.length > 0
  )
  const file = candidates.find((path) => existsSync(path)) ?? '/bin/sh'
  return { file, args: ['-c', command] }
}

/**
 * Whether a child can be spawned as its own process-group leader.
 *
 * On Unix this is what makes `kill(-pid)` take down a dev server's entire
 * tree. Windows has no process groups in that sense; `taskkill /T` walks the
 * parent/child tree instead.
 */
export const SUPPORTS_PROCESS_GROUPS = !IS_WINDOWS

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Kills a process and everything it spawned.
 *
 * Refuses any pid at or below 1: `kill(-0)` signals the caller's own process
 * group, which would take down the app itself.
 */
export function killProcessTree(pid: number, force: boolean): void {
  if (!Number.isInteger(pid) || pid <= 1) return

  if (IS_WINDOWS) {
    // /T includes the whole tree; /F is the hard kill.
    const args = ['/PID', String(pid), '/T']
    if (force) args.push('/F')
    try {
      spawn('taskkill', args, { stdio: 'ignore', windowsHide: true }).unref()
    } catch {
      // Nothing more we can do; the caller re-checks liveness.
    }
    return
  }

  const signal = force ? 'SIGKILL' : 'SIGTERM'
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }
}

/**
 * The kernel's start timestamp for a pid.
 *
 * Recorded when a process is spawned and compared before it is ever killed:
 * pids are recycled, and a stale ledger entry must never be allowed to kill an
 * unrelated process that inherited the number.
 */
export function processStartTime(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 1) return ''

  try {
    if (IS_WINDOWS) {
      return execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.Ticks`],
        { encoding: 'utf8', timeout: 4000, windowsHide: true }
      ).trim()
    }

    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2000
    }).trim()
  } catch {
    return ''
  }
}

/** Where a Python virtualenv keeps its executables. */
export const VENV_BIN = IS_WINDOWS ? 'Scripts' : 'bin'

/** Shell fragment that activates a virtualenv in the given relative folder. */
export function venvActivate(folder: string): string {
  return IS_WINDOWS
    ? `. .\\${folder}\\Scripts\\Activate.ps1; `
    : `source './${folder}/bin/activate' && `
}

export function venvExists(root: string, folder: string): boolean {
  return IS_WINDOWS
    ? existsSync(join(root, folder, 'Scripts', 'Activate.ps1'))
    : existsSync(join(root, folder, 'bin', 'activate'))
}

/**
 * Reads the user's real PATH from their login shell.
 *
 * A GUI-launched app inherits a minimal environment, so Homebrew, nvm, pyenv,
 * and anything else installed per-user is invisible to it. On Windows the
 * process environment is already the user's, so no probe is needed.
 */
export function probeLoginPath(): Promise<string | null> {
  if (IS_WINDOWS) return Promise.resolve(process.env['PATH'] ?? null)

  const shell = process.env['SHELL'] ?? '/bin/zsh'
  return new Promise((resolve) => {
    const child = execFile(
      shell,
      ['-lc', 'printf "\\0%s\\0" "$PATH"'],
      { timeout: 4000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) return resolve(null)
        // The value is wrapped in NUL bytes so that dotfile banners, version
        // notices, and nvm chatter cannot corrupt it.
        const match = /\0([^\0]*)\0/.exec(stdout)
        resolve(match?.[1]?.trim() || null)
      }
    )
    child.on('error', () => resolve(null))
  })
}

/** Directories worth adding to PATH when the probe finds nothing useful. */
export const FALLBACK_PATH_DIRS = IS_WINDOWS
  ? []
  : ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
