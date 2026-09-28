# devLaunchr design system

devLaunchr is a dense desktop tool — a sidebar of projects, a tab strip, a live
preview, a log pane. Its visual language is built for that density: neutral
zinc surfaces, hairline borders instead of shadows, and **one accent — launch
green, taken from the logo — reserved for the things that mean "go"**: a server
that is running, the button that starts one, and focus.

Every token lives in `src/renderer/styles/tokens.css`. Nothing in a component
should hardcode a colour, radius, or spacing value that is not defined there.

## Colour

### The neutral ramp

A near-achromatic zinc ramp carries every surface, border and line of text.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--surface-canvas` | `#f4f4f5` | `#111113` | Window background |
| `--surface-raised` | `#ffffff` | `#18181b` | Panels and cards on the canvas |
| `--surface-recessed` | `#fafafa` | `#141416` | Log pane, card interiors, modal footers |
| `--surface-inset` | `#f1f1f3` | `#0d0d0f` | Deepest wells: preview frames, thumbnails |
| `--border-hairline` | `#ececee` | `#26262b` | The only elevation on content surfaces |
| `--border-strong` | `#d4d4d8` | `#35353c` | Scrollbars, hovered borders |
| `--text-primary` | `#09090b` | `#f4f4f5` | Headings, body |
| `--text-secondary` | `#52525b` | `#a1a1aa` | Supporting copy |
| `--text-muted` | `#71717a` | `#85858f` | Metadata, labels |
| `--text-placeholder` | `#a1a1aa` | `#52525b` | Empty fields, disabled labels |

Pure black is never used; `#09090b` is the deepest ink. The dark theme sits
below zinc-900, toward the black field the logo is drawn on, so the accent
reads the way it does in the mark.

### Launch green

`#00e833` is sampled from the logo. It is the only hue in the interface that is
not a status colour, and it is split into roles because one value cannot do
every job — neon green on white is a fill, never text.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent-solid` | `#00e833` | `#00e833` | Fill of the primary button, running port pills, switches |
| `--accent-on` | `#09090b` | `#09090b` | Text and icons on an accent fill (≈12:1) |
| `--accent-text` | `#0c7f2a` | `#3aef64` | Accent-coloured text and icons on a surface (≥5:1) |
| `--accent-soft` | 10% tint | 10% tint | Selection, soft badges, the scan pulse |
| `--accent-border` | 32% tint | 34% tint | The border of a running project's card |

Where it appears, and nowhere else:

- **Primary action.** `Button variant="primary"` — Start, Add, Scan on the
  empty state. One per surface. Stop is `solid` (ink), not green: stopping is
  not launching.
- **Running.** The running status dot, a running card's border and port pill,
  a running tab's port, the sidebar's running count.
- **Focus and selection.** Focus rings, text selection, the selected row's
  indicator bar, a focused field's border.
- **The mark.** The title-bar mark is painted in `--accent-text`.

Never use it for large fills, body text, links, or decoration. If something
needs emphasis, use weight or contrast.

### Status

| State | Light | Dark | Shape |
|---|---|---|---|
| running | `#10b53a` | `#00e833` | Filled circle with a soft green halo |
| starting / stopping / installing | `#c2790f` | `#e0a340` | Filled circle, pulsing |
| crashed | `#c4403a` | `#ee6d63` | Diamond |
| stopped | `#a1a1aa` | `#52525b` | Hollow circle |

Status is always encoded by **shape as well as colour**, so the interface stays
readable without relying on hue.

### Tones

Callouts, chips and toasts use three tones built from the status hues:
`--tone-danger-*` (crashes, conflicts), `--tone-warn-*` (missing
dependencies or tools) and the accent (running outside devLaunchr, success).
Each tone is a soft tinted background plus a text colour that meets contrast
on it — never a saturated fill.

## Elevation

Content surfaces use a **1px hairline border and no shadow**. Shadows appear in
three places only: overlays that float above the window (modals, toasts, the
command palette) via `--shadow-overlay`; the raised controls (primary and solid
buttons) via `--shadow-control`; and a hovered project card via
`--shadow-card-hover`.

## Geometry

| Element | Radius |
|---|---|
| Chips | 8px |
| Buttons, inputs, badges | 12px |
| Cards, list rows | 14px (rows 10px) |
| Panels, modals | 16px |
| Pills | full |

These are compressed from the marketing site's 28–36px radii: at a 30px row
height a 36px radius is a lozenge, and a 14px card radius keeps the soft
feeling at list scale.

## Typography

One family — DM Sans, bundled locally as `.woff2`, never loaded from a CDN,
because the app makes no network requests to anything but loopback.

| Role | Size | Use |
|---|---|---|
| `--text-micro` | 11px | Metadata, port numbers, timestamps, eyebrows |
| `--text-caption` | 12px | Supporting copy, hints |
| `--text-ui` | 13px | Controls, list rows, body of the interface |
| `--text-body` | 15px | Prose surfaces: settings copy, empty states |
| `--text-subheading` | 18px | Modal and panel headings |
| `--text-section` | 22px | Page titles (project name, All projects) |
| `--text-display` | 28px | The empty state only |

Section headings use the `.eyebrow` class: 11px, medium, uppercase, 0.06em
tracking, muted.

**Monospace** is used in the log pane, the address bar, paths, commands and
port numbers — the one deliberate break from the single-family rule. Log lines
carry aligned timestamps and stack traces, and proportional type destroys
alignment and makes `l`/`1` and `O`/`0` ambiguous in error output.

## Spacing

4px base unit. The working range is 4–24px; a desktop tool earns its density.
Card padding is 12–16px. Vertical rhythm between panes is 10px.

## Components

The shared pieces, so a new screen is assembled rather than invented:

| Component | File | Purpose |
|---|---|---|
| `Button` | `components/Button.tsx` | `primary` · `solid` · `secondary` · `subtle` · `danger`, sizes `sm`/`md`, optional icon |
| `Icon` | `components/Icon.tsx` | Inline 16px stroke icons; no icon font or package |
| `Modal` | `components/Modal.tsx` | Every overlay: scrim, Escape, focus trap, focus return |
| `Callout` | `components/ui.tsx` | A problem and its fix, in one of the tones |
| `Segmented` | `components/ui.tsx` | Mutually exclusive options: filters, theme, viewport width |
| `Chip` | `components/ui.tsx` | Project type, "Needs install", counts |
| `Toasts` | `components/ui.tsx` | Transient messages with an info, success or error tone |
| `StatusDot` | `components/StatusDot.tsx` | The four process states |

## Theming

Light and dark are both first-class. Tailwind's theme maps each utility colour
to a CSS variable that re-resolves per theme, so `bg-canvas` and
`text-accent-text` are correct in both modes and **no component contains a
`dark:` variant**. One attribute on `<html>` flips the entire interface; the
main process owns which one, because it is the only side that can see the OS
setting.

That only works because the tokens are two layers deep: palette constants, then
role aliases. Always reference the role (`--surface-raised`), never the palette
constant, from a component.

## The pixel motif

The mark is pixel-block artwork, and that vocabulary appears in exactly one
other place: the placeholder tile shown for a project that has never run and
ships no preview image — a sparse field of blocks seeded from the project's
name, with its initials on a small tile. It is stable across restarts and
distinct per project, and deliberately achromatic and low-contrast: a
decorative tile that competes with a real screenshot beside it is worse than a
plain one.

## Motion

120ms for state changes on controls, 180ms for anything larger, both on
`cubic-bezier(0.2, 0.8, 0.3, 1)`. Overlays rise 6px and fade in. A
`prefers-reduced-motion` block reduces every animation and transition to
effectively zero — respect it.

## Writing

Interface copy is plain and specific. Name the thing that happened and the
action that fixes it.

- "Port 3000 is already in use by node (pid 15130)" — not "Failed to start"
- "Dependencies are not installed" with a **Run npm install** button — not
  "Error: exit code 127"
- "Close preview (the server keeps running)" — not "Close"

Copy never assumes the platform: it says "this Mac", "this PC" or "this
computer", and "Finder", "File Explorer" or "Files", via `platformCopy()` in
`src/renderer/labels.ts`.

Sentence case everywhere except the uppercase eyebrow labels.
