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
| Fedora / RHEL | `devLaunchr-*-linux-x86_64.rpm` | Built by the release workflow on Linux; not in v0.2.0 |

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
process-group kill, port allocation and collisions, crash and missing-binary
detection, the orphan reaper's PID-recycling guard, dependency detection across
ecosystems, and thumbnail capture.

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

## Platform differences

`src/main/platform.ts` is the only place the code branches on the operating
system. It covers the shell used to run project commands, how a process tree is
killed (`kill(-pid)` on Unix, `taskkill /T` on Windows), how a pid's start time
is read for the recycling guard, where a Python virtualenv keeps its binaries,
and how listening ports are enumerated (`lsof` versus `netstat` + `tasklist`).

## Architecture

All filesystem access, process spawning, and port logic live in the **main**
process. The renderer runs with `contextIsolation: true`, `nodeIntegration:
false`, and `sandbox: true`, and reaches the main process only through an
explicitly enumerated preload API — there is no generic `invoke(channel, ...)`
passthrough. Embedded project tabs are hardened in the main process on
`will-attach-webview`, and are refused any URL that is not loopback.

```
src/
├── main/          app lifecycle, IPC, scanning, process supervision
├── preload/       the contextBridge API, explicitly enumerated
├── renderer/      React UI
└── shared/        types and the IPC channel contract
```

## Design

`DESIGN-APP.md` documents the interface's design tokens and the reasoning
behind each one, including the three places it deliberately departs from its
source style guide.

## License

MIT — see [LICENSE](LICENSE).
