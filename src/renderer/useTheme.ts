import { useEffect, useState } from 'react'

type Resolved = 'light' | 'dark'

/**
 * The main process owns the theme — it is the only side that can see the macOS
 * system setting. The renderer mirrors it onto <html data-theme> and never
 * decides for itself.
 */
export function useTheme(): Resolved {
  const [resolved, setResolved] = useState<Resolved>('light')

  useEffect(() => {
    let cancelled = false

    void window.devlaunchr.app.getTheme().then((theme) => {
      if (!cancelled) setResolved(theme.resolved)
    })

    const unsubscribe = window.devlaunchr.app.onThemeChanged((theme) => {
      setResolved(theme.resolved)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved
  }, [resolved])

  return resolved
}
