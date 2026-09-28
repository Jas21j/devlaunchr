import type { ProjectStatus } from '@shared/types'

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  running: 'Running',
  starting: 'Starting',
  stopping: 'Stopping',
  installing: 'Installing dependencies',
  crashed: 'Crashed',
  stopped: 'Stopped'
}

/**
 * Status is carried by shape as much as by colour — a filled circle with a
 * halo, a hollow circle, a pulsing circle, a diamond — so the states stay
 * distinguishable without relying on hue. See DESIGN.md, "Status".
 */
export function StatusDot({
  status,
  size = 7
}: {
  status: ProjectStatus
  size?: number
}): React.JSX.Element {
  const pending = status === 'starting' || status === 'stopping' || status === 'installing'
  const color =
    status === 'running'
      ? 'var(--status-running)'
      : status === 'crashed'
        ? 'var(--status-crashed)'
        : status === 'stopped'
          ? 'var(--status-stopped)'
          : 'var(--status-pending)'

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={STATUS_LABELS[status]}
      title={STATUS_LABELS[status]}
    >
      {pending && (
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: color, animation: 'dl-pulse 1.4s var(--ease-out) infinite' }}
        />
      )}
      <span
        className="relative size-full"
        style={{
          background: status === 'stopped' ? 'transparent' : color,
          border: status === 'stopped' ? `1.5px solid ${color}` : 'none',
          borderRadius: status === 'crashed' ? '1.5px' : '9999px',
          transform: status === 'crashed' ? 'rotate(45deg) scale(0.86)' : undefined,
          boxShadow: status === 'running' ? '0 0 0 3px var(--accent-soft-strong)' : undefined
        }}
      />
    </span>
  )
}
