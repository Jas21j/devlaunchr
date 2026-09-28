import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * primary   — launch green; the one action a surface exists for (Start, Add)
 * solid     — ink; strong but not "go" (Stop, Save)
 * secondary — bordered; everything else
 * subtle    — borderless; toolbars and dense rows
 * danger    — borderless, red on hover; destructive but reversible actions
 */
type Variant = 'primary' | 'solid' | 'secondary' | 'subtle' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: IconName
  /** Square, icon-only button. Requires an aria-label or title. */
  iconOnly?: boolean
}

const BASE =
  'no-drag inline-flex shrink-0 items-center justify-center gap-[6px] rounded-control font-medium ' +
  'whitespace-nowrap select-none transition-[background-color,color,border-color,box-shadow] ' +
  'duration-[120ms] disabled:opacity-40 disabled:pointer-events-none'

const SIZES: Record<Size, { box: string; square: string; icon: number }> = {
  sm: { box: 'h-[26px] px-[10px] text-caption', square: 'size-[26px]', icon: 14 },
  md: { box: 'h-[30px] px-[12px] text-ui', square: 'size-[30px]', icon: 15 }
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-on hover:bg-accent-hover border border-[var(--accent-edge)]',
  solid: 'bg-[var(--button-solid-bg)] text-[var(--button-solid-text)] hover:opacity-90',
  secondary: 'border border-hairline bg-raised text-ink hover:bg-hover hover:border-strong',
  subtle: 'text-ink-secondary hover:bg-hover hover:text-ink',
  danger: 'text-ink-secondary hover:bg-[var(--tone-danger-soft)] hover:text-danger'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconOnly = false,
  className = '',
  children,
  style,
  ...props
}: ButtonProps): React.JSX.Element {
  const dims = SIZES[size]
  const raised = variant === 'primary' || variant === 'solid'
  return (
    <button
      type="button"
      {...props}
      className={`${BASE} ${iconOnly ? dims.square : dims.box} ${VARIANTS[variant]} ${className}`}
      style={raised ? { boxShadow: 'var(--shadow-control)', ...style } : style}
    >
      {icon && <Icon name={icon} size={dims.icon} />}
      {!iconOnly && children}
    </button>
  )
}

/** A keyboard shortcut hint, e.g. ⌘K. */
export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-hairline bg-recessed px-[5px] font-sans text-[10.5px] font-medium text-ink-muted">
      {children}
    </kbd>
  )
}
