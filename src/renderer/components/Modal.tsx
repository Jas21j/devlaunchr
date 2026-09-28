import { useEffect, useRef } from 'react'
import { useApp } from '../store'
import { Button } from './Button'

/**
 * The one overlay shell. Escape and a backdrop click both close it, focus
 * moves inside on open and returns to where it was on close, and Tab stays
 * inside the dialog while it is up.
 */
export function Modal({
  onClose,
  width = 520,
  label,
  dismissible = true,
  align = 'center',
  children
}: {
  onClose: () => void
  width?: number
  /** Accessible name for the dialog. */
  label: string
  /** False for flows that must be finished or cancelled explicitly. */
  dismissible?: boolean
  /** 'top' pins the dialog near the title bar, for the command palette. */
  align?: 'center' | 'top'
  children: React.ReactNode
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = panel.current
    // Focus the first field if there is one, otherwise the dialog itself.
    const first = node?.querySelector<HTMLElement>('input, textarea, select, [data-autofocus]')
    ;(first ?? node)?.focus()

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !node) return
      const focusable = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      ]
      if (focusable.length === 0) return
      const firstItem = focusable[0] as HTMLElement
      const lastItem = focusable[focusable.length - 1] as HTMLElement
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [dismissible])

  return (
    <div
      className={`animate-fade fixed inset-0 z-50 flex justify-center p-[24px] ${align === 'top' ? 'items-start pt-[72px]' : 'items-center'}`}
      style={{ background: 'var(--surface-scrim)' }}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="animate-rise flex max-h-full flex-col overflow-hidden rounded-panel bg-raised outline-none"
        style={{ width, maxWidth: '100%', boxShadow: 'var(--shadow-overlay)' }}
      >
        {children}
      </div>
    </div>
  )
}

export function ModalHeader({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-start justify-between gap-[16px] border-b border-hairline px-[20px] py-[16px]">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <h2 className="text-subheading font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
        {subtitle && <div className="truncate text-caption text-ink-muted">{subtitle}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-[8px]">{children}</div>}
    </header>
  )
}

export function ModalFooter({
  hint,
  children
}: {
  hint?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <footer className="flex shrink-0 items-center justify-between gap-[8px] border-t border-hairline bg-recessed px-[20px] py-[12px]">
      <span className="min-w-0 truncate text-caption text-ink-muted">{hint}</span>
      <div className="flex shrink-0 items-center gap-[8px]">{children}</div>
    </footer>
  )
}

/** The in-app replacement for window.confirm, driven by `askConfirm`. */
export function ConfirmDialog(): React.JSX.Element | null {
  const request = useApp((s) => s.confirm)
  const settle = useApp((s) => s.settleConfirm)
  if (!request) return null

  return (
    <Modal label={request.title} width={420} onClose={() => settle(false)}>
      <div className="flex flex-col gap-[8px] px-[20px] pb-[18px] pt-[20px]">
        <h2 className="text-body font-semibold">{request.title}</h2>
        <p className="text-ui leading-[1.5] text-ink-secondary">{request.message}</p>
      </div>
      <ModalFooter>
        <Button variant="subtle" onClick={() => settle(false)}>
          Cancel
        </Button>
        <Button
          data-autofocus
          variant={request.destructive ? 'solid' : 'primary'}
          onClick={() => settle(true)}
        >
          {request.confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
