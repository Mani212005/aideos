/**
 * File Description: Test helper that records the studio's agent session the way bin/aideos does, as the
 * repo-root .aideos_session.json that dispatchLocalAndTmux reads, so dispatch tests can pair a fake pane.
 * Inputs and outputs: agent session fields (agent, tmux session, tmux pane) -> .aideos_session.json written at the repo root.
 * Used by: backend/agentBridge/agentBridge.test.ts, backend/agentBridge/autoPrompt.test.ts, backend/agentBridge/paneDelivery.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../pipeline/filmStore";

/** Writes the session file with the same fields bin/aideos writes; omit tmuxPane for a launch with no recorded pane. */
export function writeAgentSessionFile(info: { agent?: string; tmuxSession: string; tmuxPane?: string }): void {
  const record = { agent: info.agent ?? "claude", sessionType: "tmux", tmuxSession: info.tmuxSession, tmuxPane: info.tmuxPane, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(ROOT, ".aideos_session.json"), JSON.stringify(record, null, 2), "utf8");
}
