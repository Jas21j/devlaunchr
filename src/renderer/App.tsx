import { useEffect, useRef } from 'react'
import { useTheme } from './useTheme'
import { bindMainProcessEvents, useApp } from './store'
import { runAppCommand } from './actions'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { ProjectGrid, EmptyState } from './components/ProjectGrid'
import { ProjectView } from './components/ProjectDetail'
import { ProjectEditor } from './components/ProjectEditor'
import { ScanReview } from './components/ScanReview'
import { PortsPanel } from './components/PortsPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { CommandPalette } from './components/CommandPalette'
import { ConfirmDialog } from './components/Modal'
import { Toasts } from './components/ui'

export default function App(): React.JSX.Element {
  useTheme()
  const load = useApp((s) => s.load)

  useEffect(() => {
    void load()
    const unbind = bindMainProcessEvents(runAppCommand)

    // Servers come and go in terminals while this window sits in the
    // background, so the picture is refreshed whenever it comes forward again.
    const onFocus = (): void => void window.devlaunchr.runtime.detectExternal()
    window.addEventListener('focus', onFocus)

    return () => {
      window.removeEventListener('focus', onFocus)
      unbind()
    }
  }, [load])

  // First run: go straight to a scan so the app is useful immediately. The
  // review screen still adds nothing without confirmation, and the flag means
  // this happens exactly once.
  const settings = useApp((s) => s.settings)
  const projectCount = useApp((s) => s.projects.length)
  const startScan = useApp((s) => s.startScan)
  const firstRunDone = useRef(false)

  useEffect(() => {
    if (firstRunDone.current) return
    if (!settings || settings.hasCompletedFirstScan || projectCount > 0) return
    firstRunDone.current = true
    void startScan()
  }, [settings, projectCount, startScan])

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-[10px] pb-[10px] pr-[10px]">
          <TabBar />
          <Detail />
        </main>
      </div>
      <ProjectEditor />
      <ScanReview />
      <PortsPanel />
      <SettingsPanel />
      <CommandPalette />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}

function Detail(): React.JSX.Element {
  const projects = useApp((s) => s.projects)
  const selectedId = useApp((s) => s.selectedId)
  const loaded = useApp((s) => s.settings !== null)

  if (!loaded) return <div className="flex-1 rounded-panel border border-hairline bg-raised" />
  if (projects.length === 0) return <EmptyState />

  const project = projects.find((p) => p.id === selectedId) ?? null
  if (!project) return <ProjectGrid />

  return <ProjectView key={project.id} project={project} />
}
