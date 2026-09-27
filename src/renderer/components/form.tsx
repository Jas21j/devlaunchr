import type { ComponentPropsWithRef, ReactNode } from 'react'

const CONTROL =
  'w-full rounded-control border border-hairline bg-raised px-[10px] text-ui text-ink ' +
  'placeholder:text-ink-placeholder focus:outline-none focus-visible:outline-2 ' +
  'focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-1'

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </span>
      {children}
      {hint && <span className="text-caption text-ink-muted">{hint}</span>}
    </label>
  )
}

export function Input({
  mono,
  className = '',
  ...props
}: ComponentPropsWithRef<'input'> & { mono?: boolean }): React.JSX.Element {
  return (
    <input
      {...props}
      className={`${CONTROL} h-[30px] selectable ${mono ? 'font-mono text-caption' : ''} ${className}`}
    />
  )
}

export function TextArea({
  className = '',
  ...props
}: ComponentPropsWithRef<'textarea'>): React.JSX.Element {
  return <textarea {...props} className={`${CONTROL} selectable resize-none py-[8px] ${className}`} />
}

export function Select({
  className = '',
  children,
  ...props
}: ComponentPropsWithRef<'select'>): React.JSX.Element {
  return (
    <select {...props} className={`${CONTROL} h-[30px] appearance-none ${className}`}>
      {children}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-[10px] rounded-control p-[6px] text-left hover:bg-[var(--surface-hover)]"
    >
      <span
        className="mt-[2px] flex h-[16px] w-[27px] shrink-0 items-center rounded-pill p-[2px] transition-colors duration-[120ms]"
        style={{
          background: checked ? 'var(--text-primary)' : 'var(--border-strong)'
        }}
      >
        <span
          className="size-[12px] rounded-pill transition-transform duration-[120ms]"
          style={{
            background: 'var(--surface-raised)',
            transform: checked ? 'translateX(11px)' : 'translateX(0)'
          }}
        />
      </span>
      <span className="flex flex-col gap-[2px]">
        <span className="text-ui text-ink">{label}</span>
        {hint && <span className="text-caption text-ink-muted">{hint}</span>}
      </span>
    </button>
  )
}
