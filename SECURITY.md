# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
rather than opening a public issue.

## Threat model

devLaunchr runs shell commands on the user's machine by design. That is the
feature, not a vulnerability. The commands come from the user's own project
configuration, and are treated as trusted.

What is *not* trusted, and where a report is genuinely useful:

- **Content loaded into a project preview.** Embedded tabs run with
  `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, no
  preload script, and are refused any URL that is not loopback. A way to escape
  that is a vulnerability.
- **The renderer process.** It has no Node privileges and reaches the main
  process only through an explicitly enumerated preload API. A way to invoke a
  main-process handler that is not in that list is a vulnerability.
- **Scanned filesystem content.** Project names, paths, and `package.json`
  contents come from disk and are never interpolated into a shell command. A
  path or filename that results in command execution is a vulnerability.
- **The thumbnail protocol.** `devlaunchr-thumb://` serves cached images by
  project id. A way to make it serve an arbitrary file is a vulnerability.

## What the app does not do

No network requests to any host other than loopback. No telemetry, analytics,
or crash reporting. No writes outside its own application-support directory,
except dependency installs the user explicitly triggers inside their own
project. No elevated privileges, and no modification of system files.
