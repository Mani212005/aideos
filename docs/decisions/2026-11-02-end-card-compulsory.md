<!-- File Description: Decision record that the like-and-subscribe end card (call to action) is compulsory on every video and can no longer be turned off. -->

# The end card is compulsory on every video

- **Date**: 2026-11-02 (day the pull request merged)
- **Status**: In force
- **Decided by**: owner
- **Pull requests**: https://github.com/Mani212005/aideos/pull/166 (made it compulsory), https://github.com/Mani212005/aideos/pull/161 (the per-film off switch it replaced), https://github.com/Mani212005/aideos/pull/133 (first end card, per the PR 161 description)

## Context

Aideos appends a configured like-and-subscribe end card to every render. Pull request 161 (merged 2026-10-30) added a per-film switch so one film could turn the card off. The owner then rendered the film "harnesses" and the call to action was missing: the render he pasted showed the player at 03:40 of 03:45 on the closing chapter diagram with no call to action. Music and sound effects had also been optional, and the agent did not pick them up on its first run.

## Decision

Every video has a call to action. The end card, music and sound effects are compulsory steps whenever a video is made, and delivery is refused with a plain message until all three exist. The per-film off switch is gone in practice: `aideos end-card <film> off` is refused, the editor toggle was removed, and legacy per-film disable flags are ignored.

## Why

The owner's words as recorded in the pull request: every video should have a call to action, so it should be added to the steps and made compulsory. A step that is optional gets skipped by the agent, so it has to be a gate, not a default.

## Alternatives rejected

- **Keep the per-film off switch (pull request 161).** Rejected two days after it merged: an off switch is how a video ships without a call to action.
- **A warning when the end card, music or sound effects are missing.** Rejected: the earlier music-skipped warning was already ignored on the first run. Delivery now halts instead (`backend/deliveryGate.ts`).

## Where it lives now

- `README.md` (What is Aideos) and `docs/WORKFLOW.md`, section "Compulsory finishing steps (every video)".
- `backend/deliveryGate.ts` halts render and export when a video lacks music, sound effects or the end card.
- `aideos end-card <film> on` re-stamps the card; `off` is refused.
