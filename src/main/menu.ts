import { app, BrowserWindow, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { CH, type AppCommand } from '@shared/ipc'
import { IS_MAC } from './platform'

const REPO = 'https://github.com/Jas21j/devlaunchr'

function send(command: AppCommand): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.webContents.send(CH.appCommand, command)
}

const item = (label: string, command: AppCommand, accelerator?: string): MenuItemConstructorOptions => ({
  label,
  ...(accelerator ? { accelerator } : {}),
  click: () => send(command)
})

/**
 * The application menu. It owns every keyboard shortcut, because a shortcut
 * handled in the page never fires while focus is inside a project preview —
 * the embedded page receives the key events, not devLaunchr.
 */
export function installMenu(): void {
  const settings = item(IS_MAC ? 'Settings…' : 'Settings', 'settings', 'CmdOrCtrl+,')

  const template: MenuItemConstructorOptions[] = [
    ...(IS_MAC
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              settings,
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('Add Project…', 'addProject', 'CmdOrCtrl+O'),
        item('Scan for Projects', 'scan', 'CmdOrCtrl+Shift+O'),
        { type: 'separator' },
        ...(IS_MAC ? [] : [settings, { type: 'separator' as const }]),
        IS_MAC ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        item('Command Palette…', 'palette', 'CmdOrCtrl+K'),
        item('All Projects', 'home', 'CmdOrCtrl+1'),
        item('Listening Ports', 'ports', 'CmdOrCtrl+Shift+L'),
        item('Toggle Logs', 'toggleLogs', 'CmdOrCtrl+J'),
        item('Refresh Status and Previews', 'refresh', 'CmdOrCtrl+Shift+R'),
        { type: 'separator' },
        // Reloading the interface is harmless — servers live in the main
        // process — but it is a developer affordance, not a user one.
        ...(is.dev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'devLaunchr on GitHub', click: () => void shell.openExternal(REPO) },
        { label: 'Report an Issue', click: () => void shell.openExternal(`${REPO}/issues/new/choose`) },
        { label: 'Release Notes', click: () => void shell.openExternal(`${REPO}/releases`) }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
