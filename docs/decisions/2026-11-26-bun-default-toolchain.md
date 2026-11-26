<!-- File Description: Decision record that makes Bun the default JavaScript toolchain of aideos, with npm kept selectable through AIDEOS_TOOLCHAIN. -->

# Bun is the default toolchain, npm stays selectable

- **Date**: 2026-11-26
- **Status**: Decided, not yet on main
- **Decided by**: owner ("Bun is faster, the codebase only gets bigger, so keep it as fast and optimised as possible")
- **Pull requests**: the switch itself, https://github.com/Mani212005/aideos/pull/313; the flip of the default: none yet.

## Context

On 2026-11-21 the owner decided to stay on npm ([2026-11-21-stay-on-npm-not-bun.md](2026-11-21-stay-on-npm-not-bun.md)). Pull request 313 then added `AIDEOS_TOOLCHAIN` (`scripts/toolchain.ts`), a full Bun path for every CI step (bun installs from `package-lock.json`, scripts on the Bun runtime, `bun test` one file per process through `scripts/bunTest.ts`) with npm as the default. On the Linux fleet machine the unit suite took 594 s on `node --test` and 492 s on the bun path with the same test names and 0 failures.

## Decision

Make Bun the default: `AIDEOS_TOOLCHAIN` unset means bun, CI workflows, package.json scripts, the local validation tool and the contributor docs use Bun. npm stays selectable through the same switch, so the flip is reversible by setting one variable.

## Why

- The owner's words above: speed now, and the codebase keeps growing.
- The Bun path already passed every CI job with identical test names (pull request 313), so the flip changes the default, not the checks.

## Alternatives rejected

- **Drop npm entirely, with `bun.lock` as the only lockfile.** bun cannot write `package-lock.json`, so the npm path, the Dockerfile, Vercel and the release install would lose a reproducible install; the switch would stop being reversible.
- **Keep both `bun.lock` and `package-lock.json`.** Two lockfiles that can drift.

## Where it lives now

`scripts/toolchain.ts` (the default), `.github/workflows/ci.yml`, `nightly.yml` and `update-goldens.yml` (the `toolchain` input and the repository variable), `.github/actions/install-dependencies/action.yml`, `scripts/postinstall.mjs`, `package.json`, `.no-mistakes.yaml`, and [docs/CI.md](../CI.md#toolchain-switch-bun-or-npm), which lists every place Node or npm stays and why.
