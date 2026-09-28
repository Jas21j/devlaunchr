/**
 * The interface's icon set: 16px strokes drawn inline, so there is no icon
 * font or package to load and every glyph takes the current text colour.
 */
const PATHS = {
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />,
  restart: (
    <>
      <path d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4" />
      <path d="M12.2 2.2v2.9H9.3" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 13.5 13.5" />
    </>
  ),
  settings: (
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  ports: (
    <>
      <path d="M5.5 2.5v3M10.5 2.5v3" />
      <path d="M3.5 5.5h9v2.5a4.5 4.5 0 0 1-9 0z" />
      <path d="M8 12.5v1.5" />
    </>
  ),
  scan: (
    <>
      <path d="M2.5 5.5v-2a1 1 0 0 1 1-1h2M10.5 2.5h2a1 1 0 0 1 1 1v2M13.5 10.5v2a1 1 0 0 1-1 1h-2M5.5 13.5h-2a1 1 0 0 1-1-1v-2" />
      <path d="M5 8h6" />
    </>
  ),
  refresh: (
    <>
      <path d="M13.2 6.2A5.3 5.3 0 0 0 3.4 5M2.8 9.8A5.3 5.3 0 0 0 12.6 11" />
      <path d="M13.5 2.8v3.4h-3.4M2.5 13.2V9.8h3.4" />
    </>
  ),
  external: (
    <>
      <path d="M6.5 3.5h-3v9h9v-3" />
      <path d="M9 2.5h4.5V7M13.2 2.8 7.5 8.5" />
    </>
  ),
  folder: <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />,
  star: (
    <path
      d="m8 2.3 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z"
      strokeLinejoin="round"
    />
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  chevronRight: <path d="M6 3.5 10.5 8 6 12.5" />,
  chevronLeft: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  chevronDown: <path d="M3.5 6 8 10.5 12.5 6" />,
  home: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3.5 10.5h-.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v.5" />
    </>
  ),
  terminal: (
    <>
      <path d="m3.5 5 3 3-3 3" />
      <path d="M8.5 11.5h4" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.2v3.8M8 5v.3" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.5 14 13H2z" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.2v.2" />
    </>
  ),
  check: <path d="m3.5 8.5 3 3 6-7" />,
  preview: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 5.8h12" />
    </>
  ),
  details: <path d="M3 4h10M3 8h10M3 12h6" />,
  devtools: <path d="M5.5 5 3 7.5 5.5 10M10.5 5 13 7.5 10.5 10" />,
  more: (
    <>
      <circle cx="3.5" cy="8" r=".9" fill="currentColor" />
      <circle cx="8" cy="8" r=".9" fill="currentColor" />
      <circle cx="12.5" cy="8" r=".9" fill="currentColor" />
    </>
  ),
  rocket: (
    <>
      <path d="M9.5 2.5c2.5-.6 4 .9 3.5 3.5L9 10 6 7z" strokeLinejoin="round" />
      <path d="M6 7 3.8 7.4 2.5 9.5l2.3.2M9 10l-.4 2.2-2.1 1.3-.2-2.3" strokeLinejoin="round" />
      <circle cx="10.2" cy="5.8" r=".8" />
    </>
  ),
  trash: (
    <>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5" />
      <path d="M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2" />
    </>
  )
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.5
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  )
}
