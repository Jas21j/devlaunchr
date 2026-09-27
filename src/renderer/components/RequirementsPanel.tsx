import type { Requirement } from '@shared/ipc'
import { useApp } from '../store'
import { Button } from './Button'

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
    <div className="flex flex-col gap-[10px] border-b border-hairline px-[20px] py-[14px]">
      <span className="text-ui font-medium" style={{ color: 'var(--status-pending)' }}>
        {requirements.length === 1
          ? `${requirements[0]?.label} is not installed`
          : `${requirements.length} required tools are not installed`}
      </span>

      <div className="flex flex-col gap-[8px]">
        {requirements.map((requirement) => (
          <div key={requirement.name} className="flex items-center justify-between gap-[12px]">
            <div className="flex min-w-0 flex-col">
              <span className="text-caption text-ink">{requirement.label}</span>
              <span className="truncate text-caption text-ink-muted">{requirement.reason}</span>
            </div>

            <div className="flex shrink-0 items-center gap-[6px]">
              {requirement.installCommand && (
                <Button
                  variant="primary"
                  className="h-[24px] px-[9px] text-caption"
                  title={requirement.installCommand}
                  onClick={() => void runFix(projectId, requirement.installCommand as string)}
                >
                  Install
                </Button>
              )}
              {requirement.docs && (
                <Button
                  className="h-[24px] px-[9px] text-caption"
                  onClick={() =>
                    void window.devlaunchr.system.openExternal(requirement.docs as string)
                  }
                >
                  Guide
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {requirements.every((requirement) => !requirement.installCommand) && (
        <span className="text-caption text-ink-muted">
          devLaunchr could not find a package manager to install these with, so they need
          installing by hand.
        </span>
      )}
    </div>
  )
}
