<!-- File Description: Index and format specification for the decision log, one file per owner or agent decision with its context, reasons and rejected alternatives. -->

# Decision Log

This folder records durable decisions about how aideos is built and run, one file per decision, so the reason survives after the chat or the pull request is gone. It is a record, not a rule book: the rules agents follow live in `AGENTS.md`, `docs/GOOD_VIDEO.md` and the other docs this log points at. Each entry says where the rule lives now.

## Naming convention

- One file per decision: `YYYY-MM-DD-<short-slug>.md`. The date is the day the decision was made, or the day the pull request that carried it merged when the exact day was not recorded.
- Never rewrite an old entry to change what was decided. When a decision is reversed or replaced, add a new entry and set the old entry's `Status` to `Superseded by <new file>`.
- Statuses: `In force`, `Decided, not yet on main` (the work is still in flight), `Superseded by <file>`.
- Use plain hyphens, colons and parentheses. No long dashes anywhere (see `AGENTS.md`).

## Required fields

Every entry has this shape:

1. **Header block**: date, status, decided by (`owner` or `agent`, with the words quoted when the owner's own words were recorded), and pull request links (full URLs).
2. **Context**: what was true before the decision and what prompted it.
3. **Decision**: what was decided, in one or two plain sentences.
4. **Why**: the reasons that were actually recorded. When no reason was recorded, say so instead of inventing one.
5. **Alternatives rejected**: the options that were weighed and why each lost.
6. **Where it lives now**: the files, docs or commands that carry the decision in the repository.

## Index

| Date | Decision | Decided by | Status |
| --- | --- | --- | --- |
| 2026-10-25 | [Never loosen a test to get green](2026-10-25-never-loosen-tests.md) | owner | In force |
| 2026-11-02 | [The end card is compulsory on every video](2026-11-02-end-card-compulsory.md) | owner | In force |
| 2026-11-20 | [The owner's cloned voice is the default narrator](2026-11-20-cloned-voice-default-narrator.md) | owner | In force |
| 2026-11-21 | [Narration about 1.2x and edits 20 to 30 percent faster](2026-11-21-faster-narration-and-edits.md) | owner | Decided, not yet on main |
| 2026-11-21 | [Illustrated stage: one plate and about 8 pictures, SVG keeps all text and motion](2026-11-21-illustrated-stage-picture-format.md) | owner | In force (phase 1) |
| 2026-11-21 | [Hosted Studio stays look-only for strangers](2026-11-21-hosted-studio-look-only.md) | owner | In force |
| 2026-11-21 | [Stay on npm, do not switch to bun](2026-11-21-stay-on-npm-not-bun.md) | owner | In force |
| 2026-11-21 | [Keep the "Used by" headers and add no automatic check](2026-11-21-keep-used-by-headers-no-checker.md) | owner | In force |
| 2026-11-21 | [Delete weak tests at about 60 to 70 percent confidence](2026-11-21-delete-weak-tests-policy.md) | owner | In force |
| 2026-11-21 | [A reusable verify skill with a Feature Map and evidence log](2026-11-21-verify-skill.md) | owner | In force |
| 2026-11-21 | [Purge recurring bad code habits in 16 small slices](2026-11-21-habits-purge-slicing.md) | owner | In force (slices 1 to 3 merged, slice 4 open) |
| 2026-11-21 | [Neon sign-in lives in the desktop keyring, no SSH marker](2026-11-21-neon-sign-in-desktop-keyring.md) | owner and agent | In force |

## Adding an entry

1. Copy the shape of an existing entry. Keep it short: a decision file is usually under one page.
2. Add one row to the index above, newest decisions last within a date.
3. Link the pull request by its full `https://` URL once it exists. Pull requests that have not opened yet are written as `none yet`.
4. Do not copy secrets, tokens, personal paths, recordings or voice audio into an entry.
