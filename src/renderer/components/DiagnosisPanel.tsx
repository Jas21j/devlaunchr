import type { Diagnosis, DiagnosisAction } from '@shared/ipc'
import type { Project } from '@shared/types'
import { useApp } from '../store'
import { Button } from './Button'

/**
 * A failure explained, with the next step attached.
 *
 * Shown in place of the raw error, because an exit code is not a diagnosis:
 * "Docker is not installed" with an install command beats "exit code 127"
 * every time.
 */
export function DiagnosisPanel({
  project,
  diagnosis
}: {
  project: Project
  diagnosis: Diagnosis
}): React.JSX.Element {
  const install = useApp((s) => s.install)
  const runFix = useApp((s) => s.runFix)
  const beginEdit = useApp((s) => s.beginEdit)
  const openPorts = useApp((s) => s.openPorts)

  const perform = (action: DiagnosisAction): void => {
    switch (action.kind) {
      case 'install':
        void install(project.id)
        return
      case 'run':
        void runFix(project.id, action.command)
        return
      case 'copy':
        void navigator.clipboard.writeText(action.value)
        return
      case 'docs':
        void window.devlaunchr.system.openExternal(action.url)
        return
      case 'edit':
        beginEdit(project.id)
        return
      case 'ports':
        openPorts()
    }
  }

  return (
    <div className="flex flex-col gap-[10px] border-b border-hairline px-[20px] py-[14px]">
      <div className="flex flex-col gap-[3px]">
        <span className="text-ui font-medium" style={{ color: 'var(--status-crashed)' }}>
          {diagnosis.title}
        </span>
        <p className="text-caption leading-[1.5] text-ink-secondary">
          <Formatted text={diagnosis.detail} />
        </p>
      </div>

      {diagnosis.actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {diagnosis.actions.map((action, index) => (
            <Button
              key={`${action.kind}-${index}`}
              variant={index === 0 ? 'primary' : 'ghost'}
              className="h-[26px] px-[10px] text-caption"
              onClick={() => perform(action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Renders `backtick spans` as inline code without pulling in a Markdown parser. */
function Formatted({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/`([^`]+)`/g)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="selectable font-mono text-[11px] text-ink">
            {part}
          </code>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}
