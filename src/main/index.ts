import { join } from 'node:path'
import { app, shell, BrowserWindow, nativeTheme, protocol } from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import { IS_MAC, SUPPORTS_LOGIN_ITEM } from './platform'
import { CH } from '@shared/ipc'
import { registerIpc } from './ipc'
import * as runtime from './processManager'
import * as thumbnails from './thumbnails'
import { emitter as storeEvents, getProjects, getSettings, migrate, setSettings } from './store'
import { setFallbackPackageManager } from './dependencies'
import { installMenu } from './menu'
import type { Settings } from '@shared/types'

let mainWindow: BrowserWindow | null = null

/** http(s) on a loopback host — the only thing a project tab may load. */
function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
  } catch {
    return false
  }
}

/**
 * A second launch must focus the existing window rather than starting a second
 * supervisor — two process managers would fight over the port registry and each
 * would be blind to the other's children.
 */
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

/**
 * Must run before the app is ready. Without this the custom scheme is treated
 * as opaque and an <img> pointing at it is blocked.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: thumbnails.SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false }
  }
])

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'devLaunchr',
    // macOS keeps its traffic lights over the app's own header; every other
    // platform gets a normal system title bar, because a custom one there
    // means reimplementing window controls for no benefit.
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 20 } }
      : // The menu bar stays one Alt press away; every item in it also has a
        // shortcut and a place in the command palette.
        { autoHideMenuBar: true }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#f4f4f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The embedded project previews. Each one is locked down separately in
      // `will-attach-webview` below.
      webviewTag: true
    }
  })

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    mainWindow = null
  })

  // The app shell itself must never navigate away from its own bundle; any
  // outward link belongs in the user's real browser.
  window.webContents.on('will-navigate', (event, url) => {
    if (is.dev && url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\0')) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  /**
   * Every embedded project tab is hardened here rather than trusting the
   * renderer's attributes: the renderer could be compromised by a page it
   * loads, and this is the last point the main process controls.
   */
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    // A preload script inside a project tab would run with the tab's
    // privileges on a page devLaunchr does not control.
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true

    // Project tabs exist to show local dev servers. Anything else belongs in
    // the user's real browser.
    if (!isLoopbackUrl(params.src ?? "")) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * Pushes the settings that live outside devLaunchr's own code — the theme,
 * the OS login item, the package-manager fallback — into effect. Runs at boot
 * and on every change, so the stored settings are always the source of truth.
 */
function applySettings(settings: Settings): void {
  // The OS appearance only applies when the user has chosen 'system'.
  nativeTheme.themeSource = settings.theme
  setFallbackPackageManager(settings.defaultPackageManager)

  if (manageLoginItem() && app.getLoginItemSettings().openAtLogin !== settings.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
  }
}

/**
 * An unpackaged dev build would register the bare Electron binary as the
 * login item, so only a real install touches it.
 */
const manageLoginItem = (): boolean => app.isPackaged && SUPPORTS_LOGIN_ITEM

/**
 * The login item can also be switched in the OS's own settings. At boot the
 * OS is the truth, so the stored setting follows it rather than undoing the
 * user's choice there.
 */
function adoptLoginItemFromOs(): void {
  if (!manageLoginItem()) return
  const openAtLogin = app.getLoginItemSettings().openAtLogin
  if (getSettings().launchAtLogin !== openAtLogin) setSettings({ launchAtLogin: openAtLogin })
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.devlaunchr.app')

  thumbnails.registerProtocol()
  migrate()
  adoptLoginItemFromOs()
  applySettings(getSettings())
  storeEvents.on('settings', applySettings)
  installMenu()
  registerIpc()

  mainWindow = createWindow()

  // Existing projects may have gained an og-image since they were added.
  for (const project of getProjects()) {
    thumbnails.seedFromDisk(project.id, project.path)
  }

  // Kill anything a previous session left behind BEFORE the user can start
  // something new, so a stale server cannot be mistaken for a live one or hold
  // a port we are about to hand out.
  void runtime.init().then(async (report) => {
    // Reconcile with reality before the user touches anything: projects
    // already served from a terminal show as running rather than as stopped
    // projects that mysteriously fail to start.
    await runtime.detectExternal(getProjects()).catch(() => 0)

    if (report.reaped.length === 0) return
    mainWindow?.webContents.send(CH.runtimeReaped, {
      reaped: report.reaped.map((entry) => ({
        name: entry.name,
        pid: entry.pid,
        port: entry.port
      }))
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

// On macOS the app stays resident with no windows; the Dock icon reopens it.
app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit()
})

/**
 * Quitting has to be intercepted, because every running dev server is a
 * detached process group that would otherwise outlive the app and keep its
 * port bound. `before-quit` is synchronous, so the quit is cancelled once, the
 * shutdown is awaited, and the process exits itself.
 */
let isQuitting = false

async function shutdown(): Promise<void> {
  if (isQuitting) return
  isQuitting = true

  // macOS force-kills an app that stalls on logout, so shutdown races a hard
  // ceiling rather than trusting every child to exit politely.
  const guard = setTimeout(() => app.exit(0), 9000)

  try {
    thumbnails.dispose()
    await runtime.stopAll(getProjects())
  } finally {
    clearTimeout(guard)
    app.exit(0)
  }
}

app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  void shutdown()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown())
}
