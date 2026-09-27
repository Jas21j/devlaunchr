import type { ProjectStatus } from '@shared/types'

const LABELS: Record<ProjectStatus, string> = {
  running: 'Running',
  starting: 'Starting',
  stopping: 'Stopping',
  installing: 'Installing dependencies',
  crashed: 'Crashed',
  stopped: 'Stopped'
}

/**
 * Status is carried by shape as much as by color — solid circle, hollow circle,
 * pulsing halo, diamond — so the four states stay distinguishable without
 * relying on hue. See DESIGN-APP.md, "Semantic status colors".
 */
export function StatusDot({ status }: { status: ProjectStatus }): React.JSX.Element {
  const pending = status === 'starting' || status === 'stopping' || status === 'installing'

  return (
    <span
      className="relative inline-flex size-[7px] shrink-0 items-center justify-center"
      role="img"
      aria-label={LABELS[status]}
      title={LABELS[status]}
    >
      {pending && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ background: 'var(--status-pending)' }}
        />
      )}
      <span
        className="relative size-full"
        style={{
          background: status === 'stopped' ? 'transparent' : `var(--status-${dotToken(status)})`,
          border: status === 'stopped' ? '1.5px solid var(--status-stopped)' : 'none',
          borderRadius: status === 'crashed' ? '1px' : '9999px',
          transform: status === 'crashed' ? 'rotate(45deg) scale(0.86)' : undefined
        }}
      />
    </span>
  )
}

function dotToken(status: ProjectStatus): string {
  if (status === 'running') return 'running'
  if (status === 'crashed') return 'crashed'
  if (status === 'stopped') return 'stopped'
  return 'pending'
}
