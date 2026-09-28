# Changelog

## 0.4.0 — 2026-09-27

A redesign of the whole interface, a real Settings screen, and every setting
that used to be saved but ignored now doing what it says.

### Design

- **Launch green.** The logo's neon green is now the interface's one accent:
  the Start button, running servers, focus and selection. Everything else stays
  on the zinc ramp. The dark theme moves toward the logo's black. See
  [`DESIGN.md`](DESIGN.md).
- **Home screen.** A filter row that doubles as a summary — All, Running,
  Stopped, Needs attention — with counts, a filter box, sorting by name, recent
  use or status, and cards with an always-visible Start/Stop/Install button
  instead of one that appeared only on hover.
- **Project page.** Header actions (open in editor, show in file manager,
  edit, favorite), a status line with the live address, uptime and pid, every
  problem as a callout with its fix, and commands, network and environment as
  cards. A Preview / Overview switch on both faces of a running project.
- **Command palette** (⌘K / Ctrl K): jump to any project, start, stop, open it
  in the browser or your editor, stop everything, switch theme.
- **Application menu** with shortcuts for every action. Shortcuts live in the
  menu so they work while focus is inside a project preview.
- Logs can be resized by dragging and the height is remembered; copy all lines;
  a count of stderr lines.
- Toasts have tones, so "Refreshed" is no longer shown as an error.
- In-app confirmation before removing a project.
- An icon set, a shared modal (Escape, focus trap, focus return), callouts,
  segmented controls and chips replace one-off markup.

### Settings

- New Settings screen (⌘, / Ctrl ,): theme, scan folders and depth, port range,
  startup timeout, idle auto-stop, default package manager, automatic installs,
  editor, and open at login.
- **Open in editor** works — VS Code, Cursor, Zed, Sublime Text or a custom
  command with a `{path}` placeholder. On macOS it falls back to opening the
  app when its command-line launcher is not installed.
- **Stop idle servers** works: a server devLaunchr started that has written no
  output and has not been on screen for the chosen time is stopped, and you are
  told. Adopted servers are never stopped.
- **Default package manager** is used for Node projects with no
  `packageManager` field and no lockfile.
- **Open at login** registers the app with macOS or Windows.

### Fixes

- Removing a running project now stops its server; before, the server kept
  running and holding its port with nothing left in the interface to stop it.
- Cancelling a scan no longer reopens the review screen a moment later.
- "Open in Editor" in the right-click menu did nothing.
- The Settings button was permanently disabled.
- Copy said "this Mac", "Finder" and "macOS blocked" on Windows and Linux.
- Duplicate project names were not disambiguated on Windows, whose paths have
  no forward slashes.
- The preview pane offered Start while dependencies were installing.
- The Ports panel refreshed before a stopped server had finished stopping.
- A free-port confirmation with no parent window leaked a hidden window.
- The file-manager reveal accepts only paths of known projects.
- Package-manager detection was duplicated in two modules; there is now one.

## 0.3.0 — 2026-09-26

One project, one port: a project can no longer "start" on a port another site
already holds and preview that site instead. Port checks cover every loopback
and wildcard address, frameworks are given their port explicitly, pinned ports
are checked before spawning, and a server counts as running only when every
socket on its port is its own. CI runs the full suite on macOS, Windows and
Linux.

## 0.2.0 — 2026-09-26

First public release for macOS, Windows and Linux.
