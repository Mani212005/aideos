<!-- File Description: Index and format specification for dated verification evidence logs written by the verify skill. -->

# Verification Evidence Logs

Each verified change appends a short dated record in this directory using the workflow in [.agents/skills/verify/SKILL.md](../../../.agents/skills/verify/SKILL.md).

## Naming convention

- One file per verified change: `YYYY-MM-DD-<short-slug>.md` (UTC or local date matching the run).
- For follow-up verification rounds on the same PR, append a dated round section to that change's file rather than overwriting prior evidence.

## Required fields

Every record must capture:

1. **Metadata**: date, branch or PR URL, scope (touched Feature Map rows), and risk tier (`Low`, `Medium`, `High`).
2. **Reliability checklist**: pass, fail, or `N/A` (with reason) for each checklist item.
3. **Commands run and results**: exact commands executed, exit codes, counts, and links to any artifacts or logs.
4. **Fix attempts**: count out of 3 per failure; if 3 attempts fail, include the full escalation packet.
5. **Weak-test removals**: list any removed weak test with its one-line reason, or `None`.
6. **Independent review**: reviewer model or pipeline (`no-mistakes`, separate reviewer agent, or `aideos all-check`) and verdict.

See [.agents/skills/verify/references/checklist-and-evidence.md](../../../.agents/skills/verify/references/checklist-and-evidence.md) for the copy-paste template.
