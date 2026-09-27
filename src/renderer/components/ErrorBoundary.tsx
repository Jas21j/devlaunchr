import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
  stack: string | null
}

/**
 * Without this, a render error leaves an empty white window with no clue what
 * failed — the renderer's console is not visible in a packaged app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? error.stack ?? null })
    console.error('devLaunchr renderer error', error, info)
  }

  override render(): ReactNode {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-[12px] bg-canvas p-[32px] text-center">
        <h1 className="text-subheading font-semibold text-ink">Something broke in the interface</h1>
        <p className="selectable max-w-[520px] font-mono text-caption text-ink-secondary">
          {error.message}
        </p>
        {stack && (
          <pre className="selectable max-h-[220px] max-w-[620px] overflow-auto rounded-card border border-hairline bg-raised p-[12px] text-left font-mono text-micro text-ink-muted">
            {stack.trim()}
          </pre>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-control border border-hairline bg-raised px-[12px] py-[6px] text-ui text-ink hover:bg-[var(--surface-hover)]"
        >
          Reload
        </button>
      </div>
    )
  }
}
