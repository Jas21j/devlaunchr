import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'subtle'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const BASE =
  'no-drag inline-flex items-center justify-center gap-[6px] rounded-control ' +
  'px-[12px] h-[28px] text-ui font-medium whitespace-nowrap ' +
  'transition-colors duration-[120ms] disabled:opacity-40 disabled:pointer-events-none'

export function Button({
  variant = 'ghost',
  className = '',
  ...props
}: ButtonProps): React.JSX.Element {
  if (variant === 'primary') {
    return (
      <button
        {...props}
        className={`${BASE} ${className}`}
        style={{
          background: 'var(--button-primary-bg)',
          color: 'var(--button-primary-text)',
          boxShadow: 'var(--shadow-control)'
        }}
      />
    )
  }

  if (variant === 'subtle') {
    return (
      <button
        {...props}
        className={`${BASE} text-ink-secondary hover:bg-[var(--surface-hover)] hover:text-ink ${className}`}
      />
    )
  }

  return (
    <button
      {...props}
      className={`${BASE} border border-hairline bg-raised text-ink hover:bg-[var(--surface-hover)] ${className}`}
    />
  )
}
