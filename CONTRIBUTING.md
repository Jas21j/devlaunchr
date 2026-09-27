# Contributing

Thanks for looking. devLaunchr is a desktop tool that supervises other people's
processes, so the bar for correctness in the process and port layers is higher
than the UI layer. Please read the section that matches what you're changing.

## Getting set up

```bash
npm install
npm run dev
```

Node 20 or newer. macOS 13+, Windows 10+, or a recent Linux desktop.

## Running the tests

```bash
npm run smoke
```

These are not unit tests. They boot a real Electron main process, spawn real
HTTP servers with real child processes, and assert against `lsof`/`netstat`
output. That is deliberate: the bugs worth catching here are "the grandchild
process survived the kill" and "capturePage returned a blank frame", and
neither shows up against a mock.

Everything runs against temporary directories and synthetic fixtures, so the
suite passes on a machine that has none of your projects on it.

## The rules that matter

**Never let a process outlive the app.** Every spawn is recorded in an on-disk
ledger before it starts, and cleared when it exits. On Unix children are
spawned as process-group leaders so the whole tree dies together; on Windows
the tree is walked with `taskkill /T`. If you touch this code, add a test that
kills something and then proves it is gone.

**Never kill a pid you have not identified.** Pids get recycled. The ledger
records each process's start timestamp and compares it before signalling, and
anything at or below pid 1 is refused outright — on Unix, `kill(-0)` signals
the caller's own process group.

**The renderer has no privileges.** `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`. New IPC goes in `src/shared/ipc.ts`
and is explicitly enumerated in `src/preload/index.ts`. Do not add a generic
`invoke(channel, ...args)` passthrough — it hands the renderer the whole
main-process API and makes the sandbox decorative.

**Nothing talks to the network.** The app makes no requests to any host other
than loopback. No telemetry, no analytics, no update pings, no remote fonts.
If a change needs a network call, open an issue first.

**Never modify a user's project.** devLaunchr reads project folders and runs
commands in them. It does not write to them, with one exception: installing
dependencies, which the user triggers and which is what the project's own
package manager would do anyway.

## Platform differences

`src/main/platform.ts` is the only file that should branch on
`process.platform`. If you find yourself writing a platform check elsewhere,
add a helper there instead.

## Style

TypeScript strict mode with `noUncheckedIndexedAccess`. Comments explain *why*,
not *what* — if a line needs a comment to say what it does, rename something.
The design tokens and the reasoning behind them live in `DESIGN.md`; don't
introduce a hardcoded colour or radius that isn't in there.

## Pull requests

Describe what breaks if the change is wrong. For anything in the process, port,
or ledger layers, say how you verified it — ideally with the output of the test
you added.
