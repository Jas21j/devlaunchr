import { useEffect } from 'react'
import { useApp, type Toast } from '../store'
import { Icon, type IconName } from './Icon'
import markUrl from '../assets/mark.png'

/** The mark's aspect ratio, so its box never distorts the artwork. */
const MARK_ASPECT = 320 / 174

/**
 * The mark is a white-on-alpha silhouette used as a CSS mask, so it paints in
 * whatever colour it is given and stays correct in both themes from one asset.
 */
export function BrandMark({
  height = 15,
  color = 'currentColor'
}: {
  height?: number
  color?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0"
      style={{
        height,
        width: Math.round(height * MARK_ASPECT),
        background: color,
        maskImage: `url(${markUrl})`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center'
      }}
    />
  )
}

/** A row of mutually exclusive options, e.g. theme or device width. */
export function Segmented<T extends string | number | null>({
  value,
  options,
  onChange,
  size = 'md',
  label
}: {
  value: T
  options: Array<{ value: T; label: React.ReactNode; title?: string }>
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  label: string
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="no-drag inline-flex shrink-0 items-center gap-[2px] rounded-control border border-hairline bg-recessed p-[2px]"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`rounded-[9px] font-medium transition-colors duration-[120ms] ${
              size === 'sm' ? 'h-[20px] px-[8px] text-micro' : 'h-[24px] px-[10px] text-caption'
            } ${active ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink'}`}
            style={active ? { boxShadow: '0 0 0 1px var(--border-hairline), 0 1px 2px rgba(0,0,0,0.06)' } : undefined}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

type Tone = 'danger' | 'warn' | 'info' | 'accent'

const TONES: Record<Tone, { text: string; soft: string; icon: IconName }> = {
  danger: { text: 'var(--tone-danger-text)', soft: 'var(--tone-danger-soft)', icon: 'warning' },
  warn: { text: 'var(--tone-warn-text)', soft: 'var(--tone-warn-soft)', icon: 'warning' },
  info: { text: 'var(--text-secondary)', soft: 'var(--surface-recessed)', icon: 'info' },
  accent: { text: 'var(--accent-text)', soft: 'var(--accent-soft)', icon: 'info' }
}

/**
 * A problem explained, with its fix attached. Every banner on the project
 * page — conflicts, missing tools, diagnoses — uses this one shape.
 */
export function Callout({
  tone,
  title,
  children,
  actions
}: {
  tone: Tone
  title: React.ReactNode
  children?: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  const style = TONES[tone]
  return (
    <div
      className="flex items-start gap-[12px] rounded-card px-[14px] py-[12px]"
      style={{ background: style.soft }}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span className="mt-[1px]" style={{ color: style.text }}>
        <Icon name={style.icon} size={15} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-ui font-medium" style={{ color: style.text }}>
          {title}
        </span>
        {children && <div className="text-caption leading-[1.5] text-ink-secondary">{children}</div>}
        {actions && <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">{actions}</div>}
      </div>
    </div>
  )
}

/** Small bordered label: a project type, a count, a state. */
export function Chip({
  children,
  tone = 'neutral',
  mono = false,
  title
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'warn' | 'danger'
  mono?: boolean
  title?: string
}): React.JSX.Element {
  const toneClass =
    tone === 'accent'
      ? 'border-accent-border bg-accent-soft text-accent-text'
      : tone === 'warn'
        ? 'border-transparent bg-[var(--tone-warn-soft)] text-warn'
        : tone === 'danger'
          ? 'border-transparent bg-[var(--tone-danger-soft)] text-danger'
          : 'border-hairline text-ink-secondary'
  return (
    <span
      title={title}
      className={`inline-flex h-[20px] shrink-0 items-center gap-[4px] rounded-chip border px-[7px] text-micro font-medium ${mono ? 'font-mono' : ''} ${toneClass}`}
    >
      {children}
    </span>
  )
}

/** Renders `backtick spans` as inline code without pulling in a Markdown parser. */
export function Formatted({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/`([^`]+)`/g)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="selectable rounded-[5px] bg-inset px-[4px] py-[1px] font-mono text-[11px] text-ink">
            {part}
          </code>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

// ------------------------------------------------------------------- toasts

const TOAST_ICON: Record<Toast['tone'], IconName> = { info: 'info', success: 'check', error: 'warning' }

export function Toasts(): React.JSX.Element | null {
  const toasts = useApp((s) => s.toasts)
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-[16px] left-1/2 z-[70] flex w-[min(520px,calc(100%-32px))] -translate-x-1/2 flex-col items-center gap-[8px]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }): React.JSX.Element {
  const dismiss = useApp((s) => s.dismissToast)

  useEffect(() => {
    // Errors stay long enough to read a sentence with a command in it.
    const timer = setTimeout(() => dismiss(toast.id), toast.tone === 'error' ? 9000 : 5000)
    return () => clearTimeout(timer)
  }, [toast, dismiss])

  const color =
    toast.tone === 'error'
      ? 'var(--tone-danger-text)'
      : toast.tone === 'success'
        ? 'var(--accent-text)'
        : 'var(--text-muted)'

  return (
    <button
      type="button"
      onClick={() => dismiss(toast.id)}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="animate-rise pointer-events-auto flex w-fit max-w-full items-start gap-[10px] rounded-card bg-raised px-[14px] py-[10px] text-left text-ui text-ink"
      style={{ boxShadow: 'var(--shadow-overlay)' }}
      title="Dismiss"
    >
      <span className="mt-[1px]" style={{ color }}>
        <Icon name={TOAST_ICON[toast.tone]} size={15} />
      </span>
      <span className="min-w-0">
        <Formatted text={toast.message} />
      </span>
    </button>
  )
}
