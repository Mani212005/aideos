/**
 * File Description: Rich context builder and prompt synthesizer for the Aideos Agent Bridge.
 */

import fs from "node:fs";
import path from "node:path";
import { FILM_ID, readFilm, ROOT, VIDEOS_DIR } from "../pipeline/filmStore";
import type { AgentTaskContext, DispatchOptions } from "./types";

/** Core design invariants enforced across the Aideos explainer video standard. */
export const DESIGN_INVARIANTS: string[] = [
  "Color Palette: 6-value palette (#0A0A0B canvas, #F5F5F5 text primary, #8A8A8E text muted, #635BFF accent, rgba(245,245,245,.10) hairline depth, #101013 surface).",
  "Typography: Geist for voice/narrative, JetBrains Mono for all system/code/numbers.",
  "Motion Easing: Ease-out-expo cubic-bezier(0.16, 1, 0.3, 1) for all transitions.",
  "7 Animated Primitives: TextReveal, StatCounter, CodeBlock, Card, Divider, IconLabel, ProgressBar.",
  "Single Canvas Model: 2D infinite spatial canvas with continuous camera motion and wide payoff zooms.",
  "Pacing Rhythm: Rotate visual devices (never hold >25s, no back-to-back repeats, return to canvas spine every 60-90s).",
  "Audio-Visual Sync: Lock shot durations strictly to voiceover audio narration timestamps.",
  "No Long Dashes: Zero em dashes or en dashes; use standard hyphens, colons, or parentheses.",
];

/** Assembles the full working context payload for a video package. */
export function buildTaskContext(opts: DispatchOptions, rootDir: string = ROOT): AgentTaskContext {
  const filmId = opts.filmId || "film";
  const filmTitle = opts.filmTitle || filmId;
  const videosRoot = path.join(rootDir, "videos");
  const pkgDir = path.join(videosRoot, filmId);

  // Script resolution
  let scriptText = opts.scriptText;
  const scriptPath = path.join(pkgDir, "script.md");
  if (!scriptText && fs.existsSync(scriptPath)) {
    try {
      scriptText = fs.readFileSync(scriptPath, "utf8");
    } catch (_) {}
  }

  // Film manifest resolution
  let film = null;
  if (FILM_ID.test(filmId)) {
    try {
      film = readFilm(filmId);
    } catch (_) {
      film = null;
    }
  }
  const filmPath = path.join(pkgDir, "film.json");

  // Voiceover audio resolution
  const defaultVoPath = path.join(pkgDir, "voiceover.wav");
  const voiceoverPath = opts.voiceoverFile
    ? path.isAbsolute(opts.voiceoverFile)
      ? opts.voiceoverFile
      : path.join(rootDir, opts.voiceoverFile)
    : fs.existsSync(defaultVoPath)
      ? defaultVoPath
      : undefined;

  // Word timings resolution
  const defaultWordsPath = path.join(pkgDir, "voiceover_words.json");
  const voiceoverWordsPath = opts.voiceoverWordsFile
    ? path.isAbsolute(opts.voiceoverWordsFile)
      ? opts.voiceoverWordsFile
      : path.join(rootDir, opts.voiceoverWordsFile)
    : fs.existsSync(defaultWordsPath)
      ? defaultWordsPath
      : undefined;

  let voiceoverWords: any[] | undefined;
  if (voiceoverWordsPath && fs.existsSync(voiceoverWordsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(voiceoverWordsPath, "utf8"));
      voiceoverWords = Array.isArray(raw) ? raw : raw.words || [];
    } catch (_) {}
  }

  // Duration & shots calculation
  let durationSec = opts.durationSec;
  let shotCount = opts.shotCount;

  if (durationSec === undefined && film?.shots) {
    durationSec = Number(film.shots.reduce((sum, s) => sum + (s.dur || 0), 0).toFixed(2));
  }
  if (shotCount === undefined && film?.shots) {
    shotCount = film.shots.length;
  }

  return {
    filmId,
    filmTitle,
    scriptText,
    scriptPath: fs.existsSync(scriptPath) ? path.relative(rootDir, scriptPath) : `videos/${filmId}/script.md`,
    film: film || null,
    filmPath: fs.existsSync(filmPath) ? path.relative(rootDir, filmPath) : `videos/${filmId}/film.json`,
    voiceoverPath: voiceoverPath ? path.relative(rootDir, voiceoverPath) : undefined,
    voiceoverWordsPath: voiceoverWordsPath ? path.relative(rootDir, voiceoverWordsPath) : undefined,
    voiceoverWords,
    durationSec,
    shotCount,
    directorGuideRef: "docs/DIRECTOR_GUIDE.md",
    designInvariants: DESIGN_INVARIANTS,
    customInstruction: opts.customInstruction,
    metadata: opts.metadata,
  };
}

/** Formats a structured, actionable directing prompt for the connected coding agent. */
export function buildDirectingPrompt(opts: DispatchOptions, context?: AgentTaskContext): string {
  const ctx = context || buildTaskContext(opts);
  const title = ctx.filmTitle || ctx.filmId;
  const audioRef = ctx.voiceoverPath || `videos/${ctx.filmId}/voiceover.wav`;
  const durationText = ctx.durationSec !== undefined ? `${ctx.durationSec.toFixed(1)}s` : "measured";
  const shotsText = ctx.shotCount !== undefined ? `${ctx.shotCount} shots` : "compiled shots";

  let eventHeadline = 'The human clicked "Auto-Build Scenes from Script"';
  if (opts.eventType === "voiceover_ready") {
    eventHeadline = `Voiceover audio synthesized (${durationText})`;
  } else if (opts.eventType === "script_updated") {
    eventHeadline = "Screenplay updated in Studio";
  } else if (opts.eventType === "ai_edit") {
    eventHeadline = "AI video editing program requested";
  } else if (opts.eventType === "produce_film") {
    eventHeadline = "Film production pipeline triggered";
  } else if (opts.eventType === "custom_directive") {
    eventHeadline = opts.customInstruction || "Studio user sent directing instruction";
  }

  const wordTimingInfo = ctx.voiceoverWords && ctx.voiceoverWords.length > 0
    ? `- Word Timings: ${ctx.voiceoverWords.length} words mapped in ${ctx.voiceoverWordsPath || `videos/${ctx.filmId}/voiceover_words.json`}`
    : `- Word Timings: Pending or in ${ctx.voiceoverWordsPath || `videos/${ctx.filmId}/voiceover_words.json`}`;

  return `🎬 [Aideos Studio Auto-Prompter] ${eventHeadline} for "${title}" (${ctx.filmId})

📋 Context & Video Package Artifacts:
- Screenplay: ${ctx.scriptPath}
- Film Spec: ${ctx.filmPath}
- Audio Spine: ${audioRef} (${durationText}, ${shotsText})
${wordTimingInfo}
- Director Guide: ${ctx.directorGuideRef || "docs/DIRECTOR_GUIDE.md"}

🎯 Directing Mission for Agent:
1. Review docs/DIRECTOR_GUIDE.md for creative direction, visual storytelling craft, and the 19 cinematic pacing invariants.
2. Read the screenplay in ${ctx.scriptPath} and inspect scene layouts in ${ctx.filmPath}.
3. Architect the visual scenes:
   - Design evocative visual devices (TokenStrip, MatrixGrid, LayerStack, Plot, ScaleBar, Distribution, or AnalogyInset GPU B-roll).
   - If specialized diagrams or metaphors are needed, author animated SVGs under videos/${ctx.filmId}/visuals/.
   - Ensure dynamic camera movement (cut on chapter changes, pan, zoom-in, zoom-out) across 2D canvas stations.
   - Maintain pacing: rotate visual devices (never hold >25s, no back-to-back repeats, return to canvas spine every 60-90s).
   - Keep shot durations locked to narration audio.
4. Run \`npm run validate:film ${ctx.filmPath}\` to verify with zero invariant violations.
5. If using MCP, call \`aideos_claim_task\` to acknowledge and \`aideos_complete_task\` when done.
6. The live studio at http://localhost:3001 hot-reloads automatically as you edit.`;
}
