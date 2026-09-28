import type { Diagnosis, DiagnosisAction, Requirement } from '@shared/ipc'
import type { Project } from '@shared/types'
import { useApp } from '../store'
import { Button } from './Button'
import { Callout, Formatted } from './ui'

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
  const notify = useApp((s) => s.notify)

  const perform = (action: DiagnosisAction): void => {
    switch (action.kind) {
      case 'install':
        void install(project.id)
        return
      case 'run':
        void runFix(project.id, action.command)
        return
      case 'copy':
        void navigator.clipboard.writeText(action.value).then(() => notify('Copied.', 'success'))
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
    <Callout
      tone="danger"
      title={diagnosis.title}
      actions={diagnosis.actions.map((action, index) => (
        <Button
          key={`${action.kind}-${index}`}
          size="sm"
          variant={index === 0 ? 'solid' : 'secondary'}
          onClick={() => perform(action)}
        >
          {action.label}
        </Button>
      ))}
    >
      <Formatted text={diagnosis.detail} />
    </Callout>
  )
}

/**
 * What a project still needs installed on this machine, shown before it is
 * started rather than after it fails.
 *
 * These are system-wide tools — Docker, PHP, a package manager — that
 * devLaunchr cannot vendor. The most useful thing it can do is name them and
 * offer the command that installs each one.
 */
export function RequirementsPanel({
  projectId,
  requirements
}: {
  projectId: string
  requirements: Requirement[]
}): React.JSX.Element | null {
  const runFix = useApp((s) => s.runFix)
  if (requirements.length === 0) return null

  return (
    <Callout
      tone="warn"
      title={
        requirements.length === 1
          ? `${requirements[0]?.label} is not installed`
          : `${requirements.length} required tools are not installed`
      }
    >
      <div className="mt-[4px] flex flex-col gap-[8px]">
        {requirements.map((requirement) => (
          <div key={requirement.name} className="flex items-center justify-between gap-[12px]">
            <div className="flex min-w-0 flex-col">
              <span className="text-caption font-medium text-ink">{requirement.label}</span>
              <span className="truncate text-caption text-ink-muted">{requirement.reason}</span>
            </div>
            <div className="flex shrink-0 items-center gap-[6px]">
              {requirement.installCommand && (
                <Button
                  size="sm"
                  variant="solid"
                  title={requirement.installCommand}
                  onClick={() => void runFix(projectId, requirement.installCommand as string)}
                >
                  Install
                </Button>
              )}
              {requirement.docs && (
                <Button
                  size="sm"
                  onClick={() => void window.devlaunchr.system.openExternal(requirement.docs as string)}
                >
                  Guide
                </Button>
              )}
            </div>
          </div>
        ))}
        {requirements.every((requirement) => !requirement.installCommand) && (
          <span className="text-caption text-ink-muted">
            devLaunchr could not find a package manager to install these with, so they need installing by hand.
          </span>
        )}
      </div>
    </Callout>
  )
}
