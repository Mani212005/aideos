/**
 * File Description: Auto-Prompter & Agent Dispatcher for Aideos.
 * Automatically dispatches directing instructions, screenplay events, and voiceover updates
 * from the Aideos Studio directly into the active AI coding agent running in tmux/terminal.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface AgentSessionInfo {
  agent: string;
  sessionType: "tmux" | "process" | "standalone";
  tmuxSession?: string;
  tmuxPane?: string;
  pid?: number;
  updatedAt: string;
}

export interface AutoPromptOptions {
  event: "auto_build_scenes" | "voiceover_ready" | "script_updated" | "custom_directive";
  filmId: string;
  filmTitle?: string;
  scriptText?: string;
  voiceoverFile?: string;
  durationSec?: number;
  shotCount?: number;
  customInstruction?: string;
}

export interface DispatchResult {
  ok: boolean;
  channel: "tmux" | "file_inbox" | "none";
  session?: string;
  pane?: string;
  message: string;
  prompt: string;
  error?: string;
}

const ROOT_DIR = path.resolve(__dirname, "..");
const SESSION_FILE = path.join(ROOT_DIR, ".aideos_session.json");
const EVENTS_LOG = path.join(ROOT_DIR, "state", "agent_events.jsonl");

/** Reads the current active agent session configuration. */
export function getAgentSession(): AgentSessionInfo {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      return {
        agent: data.agent || "claude",
        sessionType: data.sessionType || "tmux",
        tmuxSession: data.tmuxSession || "aideos",
        tmuxPane: data.tmuxPane,
        pid: data.pid,
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    } catch (_) {}
  }

  return {
    agent: "claude",
    sessionType: "tmux",
    tmuxSession: "aideos",
    updatedAt: new Date().toISOString(),
  };
}

/** Updates or registers the active agent session info. */
export function setAgentSession(info: Partial<AgentSessionInfo>): AgentSessionInfo {
  const current = getAgentSession();
  const next: AgentSessionInfo = {
    ...current,
    ...info,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    console.warn("[AgentPrompter] Failed to save session info:", err);
  }

  return next;
}

/** Builds the full directing instruction prompt to send to the AI coding agent. */
export function buildDirectingPrompt(opts: AutoPromptOptions): string {
  const title = opts.filmTitle || opts.filmId;
  const audioRef = opts.voiceoverFile || `videos/${opts.filmId}/voiceover.wav`;
  const durationText = opts.durationSec ? `${opts.durationSec.toFixed(1)}s` : "measured";
  const shotsText = opts.shotCount !== undefined ? `${opts.shotCount} shots` : "compiled shots";

  let eventHeadline = 'The human clicked "Auto-Build Scenes from Script"';
  if (opts.event === "voiceover_ready") {
    eventHeadline = `Voiceover audio synthesized (${durationText})`;
  } else if (opts.event === "script_updated") {
    eventHeadline = "Screenplay updated in Studio";
  } else if (opts.event === "custom_directive") {
    eventHeadline = opts.customInstruction || "Studio user sent directing instruction";
  }

  return `🎬 [Aideos Studio Auto-Prompter] ${eventHeadline} for "${title}" (${opts.filmId})

📋 Context & Video Package Artifacts:
- Screenplay: videos/${opts.filmId}/script.md
- Film Spec: videos/${opts.filmId}/film.json
- Audio Spine: ${audioRef} (${durationText}, ${shotsText})
- Director Guide: docs/DIRECTOR_GUIDE.md

🎯 Directing Mission for Agent:
1. Review docs/DIRECTOR_GUIDE.md for creative direction, visual storytelling craft, and the 19 cinematic pacing invariants.
2. Read the screenplay in videos/${opts.filmId}/script.md and inspect scene layouts in videos/${opts.filmId}/film.json.
3. Architect the visual scenes:
   - Design evocative visual devices (TokenStrip, MatrixGrid, LayerStack, Plot, ScaleBar, Distribution, or AnalogyInset GPU B-roll).
   - If specialized diagrams or metaphors are needed, author animated SVGs under videos/${opts.filmId}/visuals/.
   - Ensure dynamic camera movement (cut on chapter changes, pan, zoom-in, zoom-out) across 2D canvas stations.
   - Maintain pacing: rotate visual devices (never hold >25s, no back-to-back repeats, return to canvas spine every 60-90s).
   - Keep shot durations locked to narration audio.
4. Run \`npm run validate:film videos/${opts.filmId}/film.json\` to verify with zero invariant violations.
5. The live studio at http://localhost:3001 hot-reloads automatically as you edit.`;
}

/** Dispatches a prompt directly into the active tmux agent session or inbox. */
export function dispatchPromptToAgent(
  prompt: string,
  opts?: { sessionName?: string; pane?: string },
): DispatchResult {
  const sessionInfo = getAgentSession();
  const targetSession = opts?.sessionName || sessionInfo.tmuxSession || "aideos";
  const targetPane = opts?.pane || sessionInfo.tmuxPane;
  const target = targetPane || targetSession;

  // Persist prompt in root .aideos_task.md and event log
  try {
    fs.writeFileSync(path.join(ROOT_DIR, ".aideos_task.md"), prompt, "utf8");
    const stateDir = path.join(ROOT_DIR, "state");
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      session: target,
      promptSnippet: prompt.slice(0, 100),
    });
    fs.appendFileSync(EVENTS_LOG, `${logEntry}\n`, "utf8");
  } catch (_) {}

  // 1. Check if tmux target exists
  try {
    const hasSess = spawnSync("tmux", ["has-session", "-t", targetSession], { encoding: "utf8" });
    if (hasSess.status === 0) {
      // Use tmux buffer loading + paste to avoid shell escaping issues with large markdown blocks
      const bufName = `aideos_${Date.now()}`;
      const setBuf = spawnSync("tmux", ["set-buffer", "-b", bufName, prompt], { encoding: "utf8" });
      if (setBuf.status === 0) {
        spawnSync("tmux", ["paste-buffer", "-b", bufName, "-t", target, "-d"], { encoding: "utf8" });
        // Send Enter keystroke to submit
        spawnSync("tmux", ["send-keys", "-t", target, "Enter"], { encoding: "utf8" });

        return {
          ok: true,
          channel: "tmux",
          session: targetSession,
          pane: targetPane,
          message: `Directly prompted active coding agent in tmux session [${targetSession}]`,
          prompt,
        };
      }
    }
  } catch (err) {
    console.warn("[AgentPrompter] tmux dispatch error:", err);
  }

  // Fallback: If no tmux session is found, record to .aideos_task.md
  return {
    ok: true,
    channel: "file_inbox",
    message: "Directive written to .aideos_task.md (no active tmux session attached)",
    prompt,
  };
}
