import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Icon } from './Icon'

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
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="text-caption leading-[1.45] text-ink-muted">{hint}</span>}
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
      spellCheck={false}
      {...props}
      className={`field selectable h-[32px] ${mono ? 'font-mono text-caption' : ''} ${className}`}
    />
  )
}

export function TextArea({ className = '', ...props }: ComponentPropsWithRef<'textarea'>): React.JSX.Element {
  return <textarea {...props} className={`field selectable resize-none py-[8px] leading-[1.45] ${className}`} />
}

export function Select({
  className = '',
  children,
  ...props
}: ComponentPropsWithRef<'select'>): React.JSX.Element {
  return (
    <span className={`relative flex ${className}`}>
      <select {...props} className="field h-[32px] appearance-none pr-[30px]">
        {children}
      </select>
      <span className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2 text-ink-muted">
        <Icon name="chevronDown" size={13} />
      </span>
    </span>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="-mx-[8px] flex items-start justify-between gap-[16px] rounded-control px-[8px] py-[8px] text-left hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-col gap-[2px]">
        <span className="text-ui text-ink">{label}</span>
        {hint && <span className="text-caption leading-[1.45] text-ink-muted">{hint}</span>}
      </span>
      <span
        className="mt-[1px] flex h-[18px] w-[31px] shrink-0 items-center rounded-pill p-[2px] transition-colors duration-[120ms]"
        style={{ background: checked ? 'var(--accent-solid)' : 'var(--border-strong)' }}
      >
        <span
          className="size-[14px] rounded-pill transition-transform duration-[120ms]"
          style={{
            background: checked ? 'var(--accent-on)' : 'var(--surface-raised)',
            transform: checked ? 'translateX(13px)' : 'translateX(0)'
          }}
        />
      </span>
    </button>
  )
}
