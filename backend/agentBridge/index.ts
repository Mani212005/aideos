/**
 * File Description: Authoritative entry point and facade for the Aideos Agent Bridge Hub.
 */

export * from "./types";
export * from "./taskQueue";
export * from "./contextBuilder";
export * from "./dispatcher";

import { dispatchLocalAndTmux } from "./dispatcher";
import type { DispatchResult } from "./types";

/** Backwards-compatible prompt dispatcher targeting tmux or local task files. */
export function dispatchPromptToAgent(
  prompt: string,
  opts?: { sessionName?: string; pane?: string },
): { ok: boolean; channel: "tmux" | "file_inbox" | "none"; session?: string; pane?: string; message: string; prompt: string } {
  const res = dispatchLocalAndTmux(prompt, opts);
  if (res.tmuxSent) {
    return {
      ok: true,
      channel: "tmux",
      session: opts?.sessionName || "aideos",
      pane: opts?.pane,
      message: `Directly prompted active coding agent in tmux session [${opts?.sessionName || "aideos"}]`,
      prompt,
    };
  }
  return {
    ok: true,
    channel: "file_inbox",
    message: "Directive written to .aideos_task.md (no active tmux session attached)",
    prompt,
  };
}
