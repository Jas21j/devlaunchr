## What this changes

<!-- One or two sentences. -->

## What breaks if this is wrong

<!-- Especially for the process, port, or ledger layers. -->

## How it was verified

<!-- Paste the relevant test output. `npm run smoke` covers the critical paths. -->

- [ ] `npm run typecheck` passes
- [ ] `npm run smoke` passes
- [ ] No new network calls to anything other than loopback
- [ ] No new `process.platform` branches outside `src/main/platform.ts`
