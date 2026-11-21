<!-- File Description: Decision record for purging 18 recurring bad code habits through 16 ordered small pull requests instead of one large cleanup. -->

# Purge recurring bad code habits in 16 small slices

- **Date**: 2026-11-21
- **Status**: In force (slices 1 to 3 merged, slice 4 open when this entry was written, slices 5 to 16 not started)
- **Decided by**: owner asked for the purge and approved the sweep's slicing; the sweep and the slice order were written by an agent
- **Pull requests**: slice 1 https://github.com/Mani212005/aideos/pull/253 (merged), slice 2 https://github.com/Mani212005/aideos/pull/255 (merged), slice 3 https://github.com/Mani212005/aideos/pull/258 (merged), slice 4 https://github.com/Mani212005/aideos/pull/257 (open). Related and earlier the same day: https://github.com/Mani212005/aideos/pull/250 (local API guard, from the architecture audit).

## Context

The owner said: "check if there are any bad code habits that are present in aideos we need to immediately get rid of them as they spoil the system". His reason: code is the context a model reads, and bad code gives a bad context to the model. Four independent read-only audits had been done the same day. A scout sweep at commit `002bb52` found 18 recurring habits (5 P0, 8 P1, 5 P2), for example swallowed errors and silent fallbacks, drifted duplicate stores and parsers, dead and test-only code paired with placeholder tests, and contradicting docs and headers.

## Decision

Fix the habits in 16 ordered, small, low-risk pull requests, each its own branch and PR, starting with the owner-decided deletions. The first four slices:

1. Delete the owner-decided dead and test-only modules.
2. Replace the blanket `scripts/` ignore wildcards in `.gitignore` with one ignored folder, `scripts/local/`, without deleting the owner's personal files.
3. Remove 7 dead Studio API routes, the `mockPlanResult` backdoor, unreachable 2D-actor code and dead UI and CSS (`/api/release-channel` is kept: `bin/aideos` polls it).
4. Fix contradicting docs, stale headers and duplicated header blocks, with no "Used by" checker.

Later slices cover filmStore consolidation, voice synthesis truth, silent UI and data bugs, one model-reply parser, lint and CI gate alignment, bounded external I/O, stricter schemas, swallowed errors folder by folder, central config, test-suite habits, import cycles and the god files. Each slice keeps the hosted Studio look-only, edits neither `AGENTS.md` nor `CLAUDE.md`, and loosens no test.

## Why

The sweep's stated plan: each slice targets one habit or one clean area, is small and low risk, and preserves every test assertion, tolerance and golden unless the owner approves otherwise. The owner-decided deletions go first. No further reasoning was recorded.

## Alternatives rejected

- **One big cleanup pull request.** Not chosen: the plan is explicitly many small, independent slices, each on its own branch.
- **Leave the habits in place.** Rejected by the owner's instruction to get rid of them immediately. Lint does not catch them: for example `allowEmptyCatch: true` permits 184 swallow-shaped `catch` blocks.
- **Add an automatic "Used by" checker.** Rejected by a separate owner decision: see [2026-11-21-keep-used-by-headers-no-checker.md](2026-11-21-keep-used-by-headers-no-checker.md).

## Open questions the sweep left for the owner

Wire or delete `backend/timeline/layerAssetCheck.ts`; how to retire the 12 `assert.ok(true)` placeholders in `backend/scene/scene.test.ts` (see [2026-11-21-delete-weak-tests-policy.md](2026-11-21-delete-weak-tests-policy.md)); what production runtime the `Dockerfile` should use once the API routes are extracted (see [2026-11-21-hosted-studio-look-only.md](2026-11-21-hosted-studio-look-only.md)); and the Studio Kokoro speaking speed when routed through the worker process.
