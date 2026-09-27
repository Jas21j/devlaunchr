# devLaunchr design system

devLaunchr is a dense desktop tool — a sidebar of projects, a tab strip, a live
preview, a log pane. Its visual language is built for that density: neutral
surfaces, hairline borders instead of shadows, one accent colour reserved for
brand moments, and colour used elsewhere only where it carries meaning.

Every token lives in `src/renderer/styles/tokens.css`. Nothing in a component
should hardcode a colour, radius, or spacing value that is not defined there.

## Colour

A near-achromatic zinc ramp carries the entire interface.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--surface-canvas` | `#f4f4f5` | `#18181b` | Window background |
| `--surface-raised` | `#ffffff` | `#1f1f23` | Panels and cards on the canvas |
| `--surface-recessed` | `#fafafa` | `#161619` | Log pane, card interiors |
| `--surface-inset` | `#f4f4f5` | `#131316` | Deepest wells, image backgrounds |
| `--border-hairline` | `#ececee` | `#2c2c31` | The only elevation on content surfaces |
| `--border-strong` | `#d4d4d8` | `#3a3a41` | Scrollbars, dividers that must read |
| `--text-primary` | `#09090b` | `#f4f4f5` | Headings, body, primary buttons |
| `--text-secondary` | `#52525b` | `#a1a1aa` | Supporting copy |
| `--text-muted` | `#71717a` | `#71717a` | Metadata, labels |
| `--text-placeholder` | `#a1a1aa` | `#52525b` | Empty fields, disabled labels |

Pure black is never used; `#09090b` is the deepest ink, which keeps warmth in
the neutrals.

### The accent

`--color-ember` `#ff5a00` is the accent available to badges. The application
icon carries the brand's own neon green, which is deliberately confined to the
icon and never enters the interface.

Neither is a UI colour: never use them for body text, links, form focus, or
large fills. If something needs emphasis, use weight or contrast.

### Status colours

Four process states need to be legible at 7px. These are functional semantics,
not palette additions, and appear only as dots or 1px underlines — never as
fills, text, or borders of any size.

| State | Light | Dark |
|---|---|---|
| running | `#2f9e5f` | `#45b97a` |
| starting / stopping / installing | `#c2790f` | `#e0a340` |
| crashed | `#c4403a` | `#e8695f` |
| stopped | `#a1a1aa` | `#52525b` |

Status is always encoded by **shape as well as colour** — filled circle, hollow
circle, pulsing halo, rotated diamond — so the interface stays readable without
relying on hue.

## Elevation

Content surfaces use a **1px hairline border and no shadow**. Shadows appear in
exactly two places: overlays that float above the whole window (modals, toasts)
via `--shadow-overlay`, and the primary button's inset highlight via
`--shadow-control`.

## Geometry

Three radii repeat everywhere. Nothing visible in the UI has square corners,
and nothing goes below 12px.

| Element | Radius |
|---|---|
| Badges, tags, small controls | 12px |
| Buttons, inputs | 12px |
| Cards, list rows | 14px |
| Panels, large surfaces | 16px |
| Pills | full |

## Typography

One family — DM Sans, bundled locally as `.woff2`, never loaded from a CDN,
because the app makes no network requests to anything but loopback.

| Role | Size | Use |
|---|---|---|
| `--text-micro` | 11px | Metadata, port numbers, timestamps |
| `--text-caption` | 12px | Supporting copy, hints |
| `--text-ui` | 13px | Controls, list rows, body of the interface |
| `--text-body` | 15px | Prose surfaces: settings copy, empty states |
| `--text-subheading` | 18px | Panel headings |
| `--text-section` | 22px | Project titles |
| `--text-display` | 28px | Empty states and onboarding only |

### The one exception

**Monospace in the log pane, address bar, and port numbers.** This is the only
place the single-family rule is broken, and it is broken deliberately: log
lines carry aligned timestamps, file paths, and stack traces, and proportional
type destroys column alignment and makes `l`/`1` and `O`/`0` ambiguous in error
output. Everywhere else stays single-family.

## Spacing

4px base unit. The working range is 4–24px; a desktop tool earns its density.

`--space-4` `--space-6` `--space-8` `--space-12` `--space-16` `--space-20`
`--space-24` `--space-32` `--space-40`

Card padding is 12–16px. Vertical rhythm between panes is 10–12px.

## Theming

Light and dark are both first-class. Tailwind's theme maps each utility colour
to a CSS variable that re-resolves per theme, so `bg-canvas` is correct in both
modes and **no component contains a `dark:` variant**. One attribute on `<html>`
flips the entire interface.

That only works because the tokens are two layers deep: palette constants, then
role aliases. Always reference the role (`--surface-raised`), never the palette
constant, from a component.

## The pixel motif

The mark is pixel-block artwork, and that vocabulary appears in exactly one
other place: the placeholder tile shown for a project that has never run and
ships no preview image. The tile is a field of pixel blocks seeded from the
project's own name, so it is stable across restarts and distinct per project.

It stays achromatic and low-contrast deliberately. Placeholders sit in a grid
beside real screenshots, and a decorative tile that competes with a real
preview is worse than a plain one. The motif is brand texture, not chrome —
it never appears in the sidebar, tab strip, toolbars, or log pane, where
density and legibility matter more than character.

## Motion

120ms for state changes on controls, 180ms for anything larger, both on
`cubic-bezier(0.2, 0.8, 0.3, 1)`. A `prefers-reduced-motion` block reduces every
animation and transition to effectively zero — respect it.

## Writing

Interface copy is plain and specific. Name the thing that happened and the
action that fixes it.

- "Port 3000 is already in use by node (pid 15130)" — not "Failed to start"
- "package.json is present but node_modules has not been installed" — not
  "Error: exit code 127"
- "Closing a preview never stops the server" — not "Close"

Sentence case everywhere except the uppercase micro-labels used for section
headings.
