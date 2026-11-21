<!-- File Description: Decision record to keep the Used by field in code file headers and to add no automatic check that its entries are correct. -->

# Keep the "Used by" headers and add no automatic check

- **Date**: 2026-11-21
- **Status**: In force
- **Decided by**: owner
- **Pull requests**: https://github.com/Mani212005/aideos/pull/257 (open when this entry was written: fixes the broken headers by hand)

## Context

`AGENTS.md` requires a three-field header comment at the top of every code file: "File Description", "Inputs and outputs" and "Used by". `scripts/check_headers.ts` (part of `npm run lint` and the CI static job) fails a code file that lacks any of the three labels, but it does not check that the callers named in "Used by" exist or are right. The 2026-11-21 code habits sweep (habit H-10) found 3 "Used by:" lines naming files that do not exist, 6 top-of-file descriptions that contradicted their code and 9 files with duplicated header fields.

## Decision

Keep the "Used by" field in every header. Do not add an automatic check that its entries point at real callers. Fix broken and stale headers by hand, as the sweep's slice 4 does.

## Why

No reason beyond the decision itself was recorded. The effect is that a stale "Used by" line is fixed when someone touches the file or in a cleanup slice, and the field stays available as a quick pointer to a file's callers.

## Alternatives rejected

- **Add an automatic checker that every "Used by" entry exists.** Rejected by the owner.
- **Drop the "Used by" field.** Not chosen: the owner said to keep it.

## Where it lives now

- `AGENTS.md`, section "Code rules" (the three-field header).
- `scripts/check_headers.ts` checks that the three labels are present and nothing more. Do not extend it to resolve "Used by" targets without a new owner decision.
