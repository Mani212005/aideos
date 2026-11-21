<!-- File Description: Decision record to stay on npm and Node and not switch to bun, with the measured numbers behind it. -->

# Stay on npm, do not switch to bun

- **Date**: 2026-11-21
- **Status**: In force
- **Decided by**: owner, after an evaluation by an agent that recommended it (option A of four)
- **Pull requests**: none for the decision itself (it changes nothing in the repository). A separate task to find and fix the slow `npm ci` on CI is in flight with no pull request yet.

## Context

The owner asked whether aideos should use bun. An agent measured it on 2026-11-21 against the repository at `e39ca02`, on a 12-core Linux machine, with a copy installed by bun running the same checks. Figures labelled measured below were measured; figures labelled guess were derived from measured parts.

## Decision

Stay on npm with Node as the runtime. Do not use bun as the installer, for scripts or as the test runner. Fix the CI install slowdown with npm instead.

## Why

- Bun is much faster at installing (about 0.5 s against about 20 s on a warm machine, measured), and the suite passes on a bun-installed tree (1589 tests, 1588 pass, 1 skipped, 0 fail, identical to npm).
- But installing is a small slice of CI. About 72 percent of a CI run is the tests themselves (Node's test runner driving ffmpeg, headless Chrome, Remotion and the Rust renderer), which bun does not speed up. The `unit` job sets the wall time at about 11 minutes, and bun as installer would save about 0.2 to 0.7 minutes of that (guess).
- Bun as the runtime gave no meaningful speed-up on typecheck, the editor build, a Remotion still or the unit tests, and `bun test` is not a drop-in for `node --test`.
- A switch is a medium change: two lockfiles to replace, CI, Dockerfile, Vercel, `.no-mistakes.yaml`, the release script, about 130 lines across 32 Markdown files, and every machine needs a pinned bun. Bun and npm also install different dependency trees from the same `package.json`, and bun does not read `.npmrc`.
- The cheaper finding: since 17 Nov, `npm ci` on CI got about 3 times slower (about 16 s to about 50 s per job, measured) with no lockfile, Node or npm change. Recovering that gets most of what bun would save, with no new tool.

## Alternatives rejected

- **B. Bun as installer only.** Saves about 0.2 to 0.7 min of wall time per CI run (guess) and no time on a local check. Costs a second toolchain, a different dependency tree and changes on every machine and deploy target. Revisit only if fresh-worktree setup time or disk becomes a real pain for the agent fleet: bun's real advantage here is about 20 s and 1.2 GB saved per new worktree.
- **C. Bun for specific scripts only.** Saves about 3 s and adds a tool for seconds.
- **D. Full switch to the bun runtime and `bun test`.** No measured gain, and the test gate would change meaning.

## Where it lives now

Nothing to change in the repository: `package-lock.json` and `editor/package-lock.json` remain the lockfiles and CI runs `npm ci`. The lever for real CI speed that the evaluation named is elsewhere: split the `unit` job into shards, as the journeys job already is.
