import { useMemo } from 'react'
import type { ScanCandidate } from '@shared/ipc'
import { useApp } from '../store'
import { TYPE_LABELS, tildePath } from '../labels'
import { Button } from './Button'

export function ScanReview({ home }: { home: string }): React.JSX.Element | null {
  const scan = useApp((s) => s.scan)
  const cancelScan = useApp((s) => s.cancelScan)
  const closeScan = useApp((s) => s.closeScan)
  const commitScan = useApp((s) => s.commitScan)
  const toggleCandidate = useApp((s) => s.toggleCandidate)
  const setAll = useApp((s) => s.setAllCandidates)
  const setFilter = useApp((s) => s.setScanFilter)

  const visible = useMemo(() => {
    const candidates = scan?.result?.candidates ?? []
    const needle = scan?.filter.trim().toLowerCase() ?? ''
    if (!needle) return candidates
    return candidates.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.path.toLowerCase().includes(needle)
    )
  }, [scan?.result, scan?.filter])

  if (!scan) return null

  if (scan.status === 'scanning') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-[12px] px-[32px] py-[40px] text-center">
          <span className="text-subheading font-semibold">Scanning…</span>
          <p className="text-ui text-ink-secondary">
            {scan.progress.scanned.toLocaleString()} folders · {scan.progress.found} project
            {scan.progress.found === 1 ? '' : 's'} found
          </p>
          <p className="h-[16px] w-full truncate font-mono text-micro text-ink-placeholder">
            {tildePath(scan.progress.current, home)}
          </p>
          <Button variant="subtle" onClick={() => void cancelScan()}>
            Cancel
          </Button>
        </div>
      </Shell>
    )
  }

  const fresh = visible.filter((c) => !c.alreadyAdded)
  const selectedCount = (scan.result?.candidates ?? []).filter(
    (c) => scan.selected.has(c.path) && !c.alreadyAdded
  ).length
  const allVisibleSelected = fresh.length > 0 && fresh.every((c) => scan.selected.has(c.path))
  const knownCount = (scan.result?.candidates ?? []).filter((c) => c.alreadyAdded).length

  return (
    <Shell wide>
      <header className="flex shrink-0 items-start justify-between gap-[16px] border-b border-hairline px-[20px] py-[16px]">
        <div className="flex flex-col gap-[2px]">
          <h2 className="text-subheading font-semibold tracking-[-0.01em]">
            {scan.result?.candidates.length ?? 0} projects found
          </h2>
          <p className="text-caption text-ink-muted">
            Scanned in {scan.result?.durationMs ?? 0} ms
            {knownCount > 0 && ` · ${knownCount} already in your list`}
          </p>
        </div>
        <input
          value={scan.filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter"
          spellCheck={false}
          className="h-[28px] w-[180px] rounded-control border border-hairline bg-raised px-[10px] text-ui text-ink placeholder:text-ink-placeholder focus:outline-none"
        />
      </header>

      {(scan.result?.denied.length ?? 0) > 0 && (
        <div className="shrink-0 border-b border-hairline px-[20px] py-[10px]">
          <p className="text-caption" style={{ color: 'var(--status-pending)' }}>
            macOS blocked {scan.result?.denied.length} folder
            {scan.result?.denied.length === 1 ? '' : 's'}, so this list may be incomplete.
          </p>
          <p className="mt-[2px] text-caption text-ink-muted">
            Grant access in System Settings → Privacy &amp; Security → Files and Folders, then scan
            again. Blocked: {scan.result?.denied.slice(0, 3).map((d) => tildePath(d, home)).join(', ')}
            {(scan.result?.denied.length ?? 0) > 3 ? ` and ${(scan.result?.denied.length ?? 0) - 3} more` : ''}
          </p>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between border-b border-hairline px-[20px] py-[8px]">
        <button
          type="button"
          onClick={() => setAll(!allVisibleSelected, fresh.map((c) => c.path))}
          className="rounded-badge px-[6px] py-[2px] text-caption text-ink-secondary hover:bg-[var(--surface-hover)]"
        >
          {allVisibleSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span className="text-caption text-ink-muted">{selectedCount} selected</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-[8px]">
        {visible.map((candidate) => (
          <CandidateRow
            key={candidate.path}
            candidate={candidate}
            home={home}
            checked={scan.selected.has(candidate.path)}
            onToggle={() => toggleCandidate(candidate.path)}
          />
        ))}
        {visible.length === 0 && (
          <p className="p-[16px] text-center text-ui text-ink-muted">Nothing matches that filter.</p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-[8px] border-t border-hairline px-[20px] py-[12px]">
        <span className="text-caption text-ink-muted">
          Nothing is added until you confirm.
        </span>
        <div className="flex items-center gap-[8px]">
          <Button variant="subtle" onClick={closeScan}>
            Cancel
          </Button>
          <Button variant="primary" disabled={selectedCount === 0} onClick={() => void commitScan()}>
            Add {selectedCount} project{selectedCount === 1 ? '' : 's'}
          </Button>
        </div>
      </footer>
    </Shell>
  )
}

function CandidateRow({
  candidate,
  home,
  checked,
  onToggle
}: {
  candidate: ScanCandidate
  home: string
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  const disabled = candidate.alreadyAdded

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center gap-[10px] rounded-card px-[12px] py-[7px] text-left hover:bg-[var(--surface-hover)] disabled:pointer-events-none disabled:opacity-45"
    >
      <span
        aria-hidden
        className="flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border text-[10px] leading-none"
        style={{
          borderColor: checked && !disabled ? 'var(--text-primary)' : 'var(--border-strong)',
          background: checked && !disabled ? 'var(--text-primary)' : 'transparent',
          color: 'var(--text-inverse)'
        }}
      >
        {checked && !disabled ? '✓' : ''}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-ink">{candidate.name}</span>
        <span className="block truncate font-mono text-micro text-ink-muted">
          {tildePath(candidate.path, home)}
        </span>
      </span>

      {disabled ? (
        <span className="shrink-0 text-micro text-ink-muted">Already added</span>
      ) : (
        <span className="shrink-0 rounded-badge border border-hairline px-[7px] py-[1px] text-micro text-ink-secondary">
          {TYPE_LABELS[candidate.detection.type]}
        </span>
      )}
    </button>
  )
}

function Shell({
  children,
  wide
}: {
  children: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-[24px]"
      style={{ background: 'rgba(9, 9, 11, 0.32)' }}
    >
      <div
        className="flex max-h-full flex-col overflow-hidden rounded-panel bg-raised"
        style={{ width: wide ? 620 : 380, boxShadow: 'var(--shadow-overlay)' }}
      >
        {children}
      </div>
    </div>
  )
}
