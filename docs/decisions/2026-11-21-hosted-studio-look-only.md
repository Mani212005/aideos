<!-- File Description: Decision record that a hosted Studio deployment stays look-only for strangers while the local Studio keeps full write access. -->

# Hosted Studio stays look-only for strangers

- **Date**: 2026-11-21
- **Status**: In force
- **Decided by**: owner (recorded in the 2026-11-21 code habits sweep as "Hosted Studio stays look-only for strangers")
- **Pull requests**: https://github.com/Mani212005/aideos/pull/250 (the local API guard that enforces it)

## Context

The Studio API in `editor/vite.config.ts` used to set `Access-Control-Allow-Origin: *` on every request, answer every preflight, bind `0.0.0.0` by default and apply no authentication on write, voice synthesis or export routes. An architecture audit flagged this (finding A-02). Aideos can also be deployed (Dockerfile, Render, Vercel) so people can browse a hosted Studio.

## Decision

A hosted Studio is look-only for strangers: read-only browsing works, and so do the agent-link routes that are authenticated by a pairing code or token. Writes, edits, uploads, exports, voice synthesis and agent dispatch from a non-local origin are refused with 403 `local_studio_required`. The local Studio (loopback bind, same-origin loopback page) keeps full access. The sweep applied this by not changing hosted access controls.

## Why

The owner gave no reason beyond the decision itself. What the record shows is the audit finding it answers: an unauthenticated write, voice synthesis and export surface open to any origin (A-02). The guard fails closed, so any future non-GET route is also refused by default.

## Alternatives rejected

- **The old behavior: wildcard CORS, bind to all interfaces, no auth on writes.** Rejected: that was audit finding A-02.
- **Open hosted writes to any origin.** Rejected for strangers by this decision.
- **Open question, not decided here:** whether the owner himself should get an authenticated write path on a hosted deployment, and whether the production `Dockerfile` should keep running Vite or switch to a small `node` server once the API routes are extracted. `docs/DEPLOY_HOSTING.md` (Studio API access) still calls the hosted access model open for that reason.

## Where it lives now

- `backend/studioApiGuard.ts` owns the contract; `docs/DEPLOY_HOSTING.md`, section "Studio API access", describes it.
- `backend/studioApiGuard.test.ts` covers the guarded routes. `docs/verify/FEATURE_MAP.md` marks hosted deployment and owner auth as partly covered: no container boot or hosted multi-owner browser end-to-end test exists.
