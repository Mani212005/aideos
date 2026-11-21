<!-- File Description: Decision record that the Neon agent sign-in lives in the desktop keyring so the agent launch shim no longer sets an SSH marker. -->

# Neon sign-in lives in the desktop keyring, no SSH marker

- **Date**: 2026-11-21 (the sign-in moved at 12:52 IST)
- **Status**: In force
- **Decided by**: owner (signed in on the desktop session); the agent fleet's launch shim was updated to match by an agent
- **Pull requests**: none (a machine and fleet operations change, nothing in the repository code)

## Context

"Neon" here is the Gemini 4 Neon model that the owner uses through the `agy` agent CLI to build and review parts of aideos. On the Linux machine, `agy` kept the owner's sign-in in a file only when it saw an SSH session. To make that work, every Neon launch ran through a small shim that set an SSH marker environment variable (`SSH_CONNECTION`) before starting `agy`. Neon also had to be started without an `--effort` flag, because `agy` rejected it and silently fell back to Gemini 3.8 Flash.

## Decision

The owner's Neon sign-in now lives in the desktop keyring, so no SSH marker is needed. The launch shim is a plain pass-through: it only unsets the SSH variables and runs `agy`. Neon spawns and relaunches no longer depend on an SSH marker, and the `--effort` flag is still not passed for `gemini-4-neon-*` ids.

## Why

No reason beyond the sign-in itself moving was recorded. What the record shows is the cost of the old arrangement: the SSH marker had to be injected by the shim because an exported shell variable did not reach the terminal panes the agents run in, and a wrong or missing setting made Neon fall back silently to another model. With the sign-in in the keyring none of that is needed.

## Alternatives rejected

- **Keep the SSH marker shim.** Superseded, not argued against: it was a workaround for where `agy` stored the sign-in, and the sign-in no longer lives there. Earlier notes that tell a launcher to set the marker are out of date.
- Other options were not recorded.

## Where it lives now

Nowhere in the aideos repository. It is recorded here so a reader who finds an older note about an SSH marker knows it no longer applies. When a Neon agent starts, confirm its footer shows "Gemini 4 Neon", because a wrong model id falls back silently. Never write the sign-in, tokens or keyring contents into the repository, a pull request or a log.
