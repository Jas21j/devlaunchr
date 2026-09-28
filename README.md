# devLaunchr

*A [Public Works](https://salesmansolutions.net/public-works/) release from [Salesman Solutions](https://salesmansolutions.net). Free and open source.*

A local dev portal for macOS, Windows, and Linux. It finds every web project on
your machine, starts any of them with one click, previews them in embedded tabs,
and — the part that actually matters — never leaves an orphaned process behind.

No AI, no telemetry, no analytics, no cloud calls. Everything is filesystem
scanning, process supervision, and HTTP health checks against loopback.

## What it does

- **Scans your machine** for runnable projects — Vite, Next.js, Node, Django,
  Flask, PHP, Docker Compose, and plain static folders — and shows them for
  review before anything is added.
- **Starts and stops them** with real process supervision: detached process
  groups, `SIGTERM` then `SIGKILL`, and an on-disk ledger so orphans from a
  crashed session get cleaned up at the next launch.
- **Installs missing dependencies automatically** — `npm`/`pnpm`/`yarn`/`bun`,
  `uv`/`poetry`/`pipenv`/`pip` with a real virtualenv, or `composer` — so a
  freshly cloned repo runs on the first click instead of failing with exit 127.
- **Previews each project** in its own tab with back/forward, an address bar,
  device-width presets, DevTools, and per-project Start/Stop.
- **Shows a preview image per project** — a real screenshot once it has run,
  the project's own Open Graph image before that.
- **Lists every listening port on the machine**, yours or not, so a port
  collision names the process holding it instead of printing an error code.
- **Keeps every project on its own port.** A preview only ever shows the
  project it belongs to: see [One project, one port](#one-project-one-port).
- **Gets you anywhere from the keyboard.** A command palette (⌘K / Ctrl K)
  jumps to any project and starts, stops or opens it; every menu action has a
  shortcut that works even while a preview has focus.
- **Opens projects in your editor** — VS Code, Cursor, Zed, Sublime Text, or
  any command you give it.
- **Stops servers nobody is using**, if you ask it to: a server devLaunchr
  started that has written no output and has not been on screen for the time
  you choose is shut down. Servers you started elsewhere are never touched.

## Download

Grab the build for your platform from the
[latest release](https://github.com/Jas21j/devlaunchr/releases/latest).

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `devLaunchr-*-mac-arm64.dmg` | macOS 13+ |
| macOS (Intel) | `devLaunchr-*-mac-x64.dmg` | macOS 13+ |
| Windows | `devLaunchr-*-win-x64-setup.exe` | Installer, no admin required |
| Windows (portable) | `devLaunchr-*-win-x64-portable.exe` | No install |
| Linux | `devLaunchr-*-linux-x86_64.AppImage` | `chmod +x`, then run |
| Debian / Ubuntu | `devLaunchr-*-linux-amd64.deb` | |
| Fedora / RHEL | `devLaunchr-*-linux-x86_64.rpm` | |

Releases are unsigned unless a signing certificate is configured, so macOS will
warn on first launch — right-click the app and choose Open. Windows SmartScreen
will show "More info → Run anyway".

### Why there is no mobile version

devLaunchr works by scanning your filesystem, spawning `npm run dev` and
friends, and killing process groups. iOS and Android forbid all three: an app
cannot run arbitrary executables or read outside its sandbox. There is no
meaningful way to run a dev server on a phone, so there is no iOS or Android
build and there will not be one.

The realistic version of "use it from my phone" is a companion web UI served on
your local network, letting a phone browser start and stop projects that run on
your computer. That is tracked as a roadmap item, not shipped.

## Using it

The home screen shows every project with its preview image and a filter row
that doubles as a summary — how many are running, stopped, or need attention
before they can run. Click a project for its page: its live preview (once it is
running), an overview of its commands, port and environment, and any problem
with the one action that fixes it.

| Shortcut (macOS / Windows & Linux) | Does |
|---|---|
| ⌘K / Ctrl K | Command palette |
| ⌘, / Ctrl , | Settings |
| ⌘1 / Ctrl 1 | All projects |
| ⌘O / Ctrl O | Add a project folder |
| ⌘⇧O / Ctrl Shift O | Scan for projects |
| ⌘⇧L / Ctrl Shift L | Listening ports |
| ⌘J / Ctrl J | Show or hide logs |
| ⌘⇧R / Ctrl Shift R | Refresh status and preview images |

Settings cover the theme, which folders a scan walks and how deep, the port
range, the startup timeout, idle auto-stop, the default package manager for
projects with no lockfile, automatic dependency installs, your editor, and
opening at login (macOS and Windows).

## Requirements

- **macOS** 13 or later, Apple Silicon or Intel
- **Windows** 10 or later
- **Linux** a recent desktop with GTK 3; `lsof` for the ports panel
- **Node 20+** to build from source

## Development

```bash
npm install
npm run dev
```

## Tests

The suite runs inside a real Electron main process against real spawned
servers, throwaway `userData` directories, and synthetic project fixtures — it
does not depend on anything existing on the machine it runs on.

```bash
npm run smoke
```

It covers persistence and normalization, process start/stop including
process-group kill, port allocation and collisions (including ports shared
across addresses and framework port flags), crash and missing-binary
detection, the orphan reaper's PID-recycling guard, dependency detection across
ecosystems, the default-package-manager fallback, editor launch commands, the
idle auto-stop policy, and thumbnail capture.

## Build

```bash
npm run dist          # every target for the current platform
npm run dist:mac      # .dmg + .zip, arm64 and x64
npm run dist:win      # NSIS installer + portable .exe
npm run dist:linux    # AppImage, .deb, .rpm
```

Building `.rpm` on macOS additionally needs `rpmbuild` (`brew install rpm`);
without it `dist:linux` still produces the AppImage and `.deb` and then fails
on the rpm step. The release workflow builds it natively on Linux, where the
tool is present.

Each platform's installers are built on that platform. Cross-building a Windows
installer from macOS needs Wine, and a `.deb` needs fakeroot; the release
workflow in `.github/workflows/release.yml` builds all three natively on
GitHub-hosted runners and attaches them to a draft release when you push a
`v*` tag.

To ship signed macOS builds, set the `MAC_CERTIFICATE` and
`MAC_CERTIFICATE_PASSWORD` repository secrets. Without them, builds are ad-hoc
signed — they run locally but warn on other machines.

## One project, one port

Starting one project must never open another project's site. On macOS (and on
Windows with some servers) two processes can listen on the same port at once,
one on `127.0.0.1` and the other on `0.0.0.0` or `::1`; a browser asking for
`localhost` then gets whichever socket is more specific. Vite, Astro, Next and
Nuxt also ignore `$PORT` and start on their own default, which is how a second
project ends up "running" on the first one's port. devLaunchr closes each gap:

- **A port is free only if nothing answers on it anywhere.** The check binds
  `127.0.0.1`, `::1`, `0.0.0.0` and `::`, tries to connect to both loopbacks,
  and consults the listener table. Any hit means taken.
- **Frameworks get their port explicitly.** For a plain `npm run dev` style
  script, devLaunchr passes `--port` and a loopback `--host` to Vite, Astro,
  Next and Nuxt (Vite also gets `--strictPort`). Custom commands, compound
  scripts and scripts that already choose a port are left untouched. The port
  is written into the command as a number, so it also works under PowerShell.
- **A pinned port is checked before anything is spawned.** If a start command
  names its own port and something holds it, the start stops with the holder's
  name instead of timing out.
- **Healthy means ours, and only ours.** A server counts as running only when
  every socket on its port belongs to the process tree devLaunchr started. A
  port shared with a stranger is reported as a conflict naming that process,
  and the project's server is stopped rather than left holding the port.
- **Previews use the project's own address.** The URL comes from the socket
  the project bound (`127.0.0.1` or `[::1]`), never from "whatever answers on
  localhost". The Ports panel follows the same rule.

All of this reads from one cached snapshot of the process and socket tables
(`src/main/processTable.ts`), batched into a single `lsof`/`ps` call instead of
one subprocess per listener. `npm run smoke:ports` reproduces each collision
with a real foreign server and checks what the preview would actually show.

## Platform differences

`src/main/platform.ts` and `src/main/processTable.ts` are the only places the
code branches on the operating system. The first covers the shell used to run
project commands, how an argument is quoted for that shell, whether the OS
supports login items, how a process tree is
killed (`kill(-pid)` on Unix, `taskkill /T` on Windows), how a pid's start time
is read for the recycling guard, where a Python virtualenv keeps its binaries,
and how listening ports are enumerated (`lsof` versus `netstat` + `tasklist`).
The second reads the process tree and per-process details (`ps` and `lsof`
versus `Get-CimInstance`).

## Architecture

All filesystem access, process spawning, and port logic live in the **main**
process. The renderer runs with `contextIsolation: true`, `nodeIntegration:
false`, and `sandbox: true`, and reaches the main process only through an
explicitly enumerated preload API — there is no generic `invoke(channel, ...)`
passthrough. Embedded project tabs are hardened in the main process on
`will-attach-webview`, and are refused any URL that is not loopback.

```
src/
├── main/          app lifecycle, menu, IPC, scanning, process supervision
├── preload/       the contextBridge API, explicitly enumerated
├── renderer/      React UI
└── shared/        types and the IPC channel contract
```

Keyboard shortcuts belong to the native application menu (`src/main/menu.ts`),
which sends a command to the window. A shortcut handled inside the page would
never fire while focus is in a project preview, because the embedded page
receives the key events.

## Design

[`DESIGN.md`](DESIGN.md) documents the design system: the zinc surfaces, the
single launch-green accent taken from the logo and exactly where it is allowed,
status encoding, type, geometry, the shared components, and the writing rules.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
