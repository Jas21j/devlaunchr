import type { ContextMenuAction } from '@shared/ipc'
import type { Project } from '@shared/types'
import { useApp, runtimeOf } from './store'

/** Maps a chosen native-menu item onto a store action. */
export async function runContextAction(
  action: ContextMenuAction,
  project: Project
): Promise<void> {
  const state = useApp.getState()
  const runtime = runtimeOf(state, project.id)

  switch (action) {
    case 'start':
      await state.start(project.id)
      return
    case 'stop':
      await state.stop(project.id)
      return
    case 'restart':
      await state.restart(project.id)
      return
    case 'openExternal':
      if (runtime.url) await window.devlaunchr.system.openExternal(runtime.url)
      return
    case 'copyUrl':
      if (runtime.url) await navigator.clipboard.writeText(runtime.url)
      return
    case 'revealInFinder':
      await window.devlaunchr.system.revealInFinder(project.path)
      return
    case 'toggleFavorite':
      await state.toggleFavorite(project.id)
      return
    case 'edit':
      state.beginEdit(project.id)
      return
    case 'remove':
      await state.remove(project.id)
      return
    default:
      return
  }
}

export async function openContextMenu(project: Project): Promise<void> {
  // The main process re-derives canStart/canStop from live runtime state; the
  // renderer's copy is only a hint and could be a frame stale.
  const runtime = runtimeOf(useApp.getState(), project.id)
  const action = await window.devlaunchr.system.contextMenu({
    projectId: project.id,
    favorite: project.favorite,
    canStart: runtime.status === 'stopped' || runtime.status === 'crashed',
    canStop: runtime.status === 'running' || runtime.status === 'starting',
    hasUrl: runtime.url !== null
  })
  if (action) await runContextAction(action, project)
}
