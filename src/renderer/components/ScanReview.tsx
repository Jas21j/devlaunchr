import { useMemo } from 'react'
import type { ScanCandidate } from '@shared/ipc'
import { useApp } from '../store'
import { TYPE_LABELS, tildePath, platformCopy, plural } from '../labels'
import { Button } from './Button'
import { Icon } from './Icon'
import { Callout, Chip } from './ui'
import { Modal, ModalFooter, ModalHeader } from './Modal'

export function ScanReview(): React.JSX.Element | null {
  const scan = useApp((s) => s.scan)
  const home = useApp((s) => s.info?.home ?? '')
  const platform = useApp((s) => s.info?.platform)
  const cancelScan = useApp((s) => s.cancelScan)
  const closeScan = useApp((s) => s.closeScan)
  const commitScan = useApp((s) => s.commitScan)
  const toggleCandidate = useApp((s) => s.toggleCandidate)
  const setAll = useApp((s) => s.setAllCandidates)
  const setFilter = useApp((s) => s.setScanFilter)
  const openSettings = useApp((s) => s.openSettings)
  const copy = platformCopy(platform)

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
      <Modal label="Scanning" width={400} onClose={() => void cancelScan()}>
        <div className="flex flex-col items-center gap-[12px] px-[32px] pb-[28px] pt-[36px] text-center">
          <span className="relative flex size-[44px] items-center justify-center rounded-[14px] bg-accent-soft text-accent-text">
            <Icon name="scan" size={20} />
            <span className="absolute inset-0 animate-ping rounded-[14px] border border-accent-border" />
          </span>
          <span className="text-subheading font-semibold">Scanning {copy.computer}…</span>
          <p className="text-ui tabular-nums text-ink-secondary">
            {scan.progress.scanned.toLocaleString()} folders · {plural(scan.progress.found, 'project')} found
          </p>
          <p className="h-[16px] w-full truncate font-mono text-micro text-ink-placeholder">
            {tildePath(scan.progress.current, home)}
          </p>
          <Button variant="subtle" onClick={() => void cancelScan()}>
            Cancel
          </Button>
        </div>
      </Modal>
    )
  }

  const candidates = scan.result?.candidates ?? []
  const fresh = visible.filter((c) => !c.alreadyAdded)
  const selectedCount = candidates.filter((c) => scan.selected.has(c.path) && !c.alreadyAdded).length
  const allVisibleSelected = fresh.length > 0 && fresh.every((c) => scan.selected.has(c.path))
  const knownCount = candidates.filter((c) => c.alreadyAdded).length
  const denied = scan.result?.denied ?? []

  return (
    <Modal label="Scan results" width={640} onClose={closeScan}>
      <ModalHeader
        title={candidates.length === 0 ? 'No projects found' : `${plural(candidates.length, 'project')} found`}
        subtitle={
          <>
            Scanned in {((scan.result?.durationMs ?? 0) / 1000).toFixed(1)}s
            {knownCount > 0 && ` · ${knownCount} already in your list`}
          </>
        }
      >
        {candidates.length > 0 && (
          <label className="relative flex items-center">
            <span className="pointer-events-none absolute left-[9px] text-ink-placeholder">
              <Icon name="search" size={13} />
            </span>
            <input
              value={scan.filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter"
              spellCheck={false}
              aria-label="Filter results"
              className="field h-[30px] w-[180px] pl-[28px]"
            />
          </label>
        )}
      </ModalHeader>

      {denied.length > 0 && (
        <div className="shrink-0 px-[20px] pt-[12px]">
          <Callout
            tone="warn"
            title={`${copy.isMac ? 'macOS blocked' : 'Could not read'} ${plural(denied.length, 'folder')}, so this list may be incomplete`}
          >
            {copy.isMac
              ? 'Grant access in System Settings → Privacy & Security → Files and Folders, then scan again. '
              : 'Check the folder permissions, then scan again. '}
            Blocked: {denied.slice(0, 3).map((d) => tildePath(d, home)).join(', ')}
            {denied.length > 3 ? ` and ${denied.length - 3} more` : ''}
          </Callout>
        </div>
      )}

      {candidates.length === 0 ? (
        <div className="flex flex-col items-center gap-[10px] px-[32px] py-[40px] text-center">
          <p className="max-w-[400px] text-ui leading-[1.5] text-ink-secondary">
            Nothing that looks like a runnable project was found in your scan folders. Add the folders you keep code
            in, or raise the scan depth.
          </p>
          <Button
            icon="settings"
            onClick={() => {
              closeScan()
              openSettings('projects')
            }}
          >
            Scan settings
          </Button>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between border-b border-hairline px-[20px] py-[8px]">
            <button
              type="button"
              onClick={() => setAll(!allVisibleSelected, fresh.map((c) => c.path))}
              disabled={fresh.length === 0}
              className="rounded-[8px] px-[6px] py-[2px] text-caption font-medium text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40"
            >
              {allVisibleSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-caption tabular-nums text-ink-muted">{selectedCount} selected</span>
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
        </>
      )}

      <ModalFooter hint="Nothing is added until you confirm.">
        <Button variant="subtle" onClick={closeScan}>
          {candidates.length === 0 ? 'Close' : 'Cancel'}
        </Button>
        {candidates.length > 0 && (
          <Button variant="primary" disabled={selectedCount === 0} onClick={() => void commitScan()}>
            Add {plural(selectedCount, 'project')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
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
  const on = checked && !disabled

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center gap-[12px] rounded-[10px] px-[12px] py-[8px] text-left hover:bg-hover disabled:pointer-events-none disabled:opacity-45"
    >
      <span
        aria-hidden
        className="flex size-[16px] shrink-0 items-center justify-center rounded-[5px] border transition-colors"
        style={{
          borderColor: on ? 'var(--accent-edge)' : 'var(--border-strong)',
          background: on ? 'var(--accent-solid)' : 'transparent',
          color: 'var(--accent-on)'
        }}
      >
        {on && <Icon name="check" size={11} strokeWidth={2.2} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-ink">{candidate.name}</span>
        <span className="block truncate font-mono text-micro text-ink-muted">{tildePath(candidate.path, home)}</span>
      </span>

      {disabled ? (
        <span className="shrink-0 text-micro text-ink-muted">Already added</span>
      ) : (
        <Chip>{TYPE_LABELS[candidate.detection.type]}</Chip>
      )}
    </button>
  )
}
