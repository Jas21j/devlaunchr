import { useApp } from '../store'
import { platformCopy } from '../labels'
import { Button, Kbd } from './Button'
import { Icon } from './Icon'
import { BrandMark } from './ui'

export function TitleBar(): React.JSX.Element {
  const platform = useApp((s) => s.info?.platform)
  const version = useApp((s) => s.info?.version)
  const startScan = useApp((s) => s.startScan)
  const openPorts = useApp((s) => s.openPorts)
  const openPalette = useApp((s) => s.openPalette)
  const openSettings = useApp((s) => s.openSettings)
  const select = useApp((s) => s.select)
  const copy = platformCopy(platform)

  return (
    <header
      className="drag-region relative flex h-[var(--titlebar-height)] shrink-0 items-center justify-between gap-[12px] pr-[12px]"
      // Only macOS overlays its window controls on our header; elsewhere the
      // system draws its own title bar and this gutter would be dead space.
      style={{ paddingLeft: copy.isMac ? 86 : 14 }}
    >
      <button
        type="button"
        onClick={() => select(null)}
        className="no-drag flex items-center gap-[8px] rounded-control px-[6px] py-[4px] hover:bg-hover"
        title="All projects"
      >
        <BrandMark height={15} color="var(--accent-text)" />
        <span className="text-ui font-semibold tracking-[-0.01em]">devLaunchr</span>
        {version && <span className="text-micro text-ink-placeholder">v{version}</span>}
      </button>

      {/* Centred on the window, not on the space left over, so it stays put. */}
      <button
        type="button"
        onClick={openPalette}
        className="no-drag absolute left-1/2 flex h-[30px] w-[min(380px,34vw)] -translate-x-1/2 items-center gap-[8px] rounded-control border border-hairline bg-raised px-[10px] text-ink-placeholder transition-colors hover:border-strong hover:text-ink-muted"
      >
        <Icon name="search" size={14} />
        <span className="flex-1 truncate text-left text-ui">Search projects and actions</span>
        <Kbd>{copy.mod === '⌘' ? '⌘K' : 'Ctrl K'}</Kbd>
      </button>

      <div className="flex items-center gap-[6px]">
        <Button variant="subtle" icon="ports" onClick={openPorts} title="Every port this computer is listening on">
          Ports
        </Button>
        <Button variant="subtle" icon="scan" onClick={() => void startScan()} title={`Find projects on ${copy.computer}`}>
          Scan
        </Button>
        <Button
          variant="subtle"
          icon="settings"
          iconOnly
          aria-label="Settings"
          title={`Settings (${copy.mod === '⌘' ? '⌘,' : 'Ctrl+,'})`}
          onClick={() => openSettings()}
        />
      </div>
    </header>
  )
}
