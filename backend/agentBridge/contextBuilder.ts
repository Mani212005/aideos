/**
 * File Description: Rich context builder and prompt synthesizer for the Aideos Agent Bridge.
 * Inputs and outputs: film and shot context -> serialized prompt strings for agent dispatch.
 * Used by: backend/agentBridge/dispatcher.ts, backend/agentBridge/index.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { FILM_ID, readFilm, ROOT } from "../pipeline/filmStore";
import type { AgentTaskContext, DispatchOptions } from "./types";
import { RUBRIC_SUMMARY } from "../goodVideoRubric";
import { getVideosDir } from "../../src/dl/videoPackageLoader";

/** Core design invariants enforced across the Aideos explainer video standard. */
export const DESIGN_INVARIANTS: string[] = [
  "Color Palette: Per-film declared palette with a measured contrast floor.",
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
  const videosRoot = rootDir === ROOT ? getVideosDir() : path.join(rootDir, "videos");
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
  if (opts.eventType === "design_film") {
    // The brief is the whole contract; the prompt only points at it and at the one gate.
    const shotId = typeof opts.metadata?.shotId === "string" ? opts.metadata.shotId : null;
    if (shotId) {
      return `🎬 [Aideos Studio] Redesign shot ${shotId} of "${title}" (${ctx.filmId})

The human asked for a new design for this one shot${opts.customInstruction ? `: "${opts.customInstruction}"` : "."}
${opts.metadata?.says ? `It says: ${opts.metadata.says}\n` : ""}
1. Read videos/${ctx.filmId}/design/BRIEF.md (refreshed just now) for the standard layer, the format and the commands.
2. If videos/${ctx.filmId}/design/design.json exists, change only what ${shotId} shows: its clips (cued to its words) and, if needed, its \`shots.${shotId}\` cards. Keep every other shot as it is.
   If there is no design.json yet, design the whole film as the brief describes, giving ${shotId} particular care.
3. Run \`aideos design build ${ctx.filmId}\` until it prints PASS, then \`aideos design check ${ctx.filmId} --stills\` and look at ${shotId}'s still.
The studio reloads the film on its own once a build passes.`;
    }
    return `🎬 [Aideos Studio] Design the picture for "${title}" (${ctx.filmId})

This film gets a bespoke design, unique to it. Everything you need is in videos/${ctx.filmId}/design/BRIEF.md:
what the film says shot by shot, the standard layer, the design.json format and the commands.

1. Read videos/${ctx.filmId}/design/BRIEF.md.
2. Write videos/${ctx.filmId}/design/design.json and the SVG artwork it names in videos/${ctx.filmId}/visuals/.
3. Run \`aideos design build ${ctx.filmId}\` and fix what it reports until it prints PASS.
4. Run \`aideos design check ${ctx.filmId} --stills\`, look at the stills in .frames/${ctx.filmId}/, and improve anything that reads badly, then build again.
The studio reloads the film on its own once a build passes.${opts.customInstruction ? `\n\nThe vision judge ruled some sampled frames wrong. Fix these first, exactly as reported:\n${opts.customInstruction}` : ""}`;
  }
  if (opts.eventType === "frame_review") {
    const stride = typeof opts.metadata?.stride === "number" ? opts.metadata.stride : 6;
    const count = typeof opts.metadata?.sampleCount === "number" ? opts.metadata.sampleCount : "the";
    return `🎬 [Aideos Studio] Review ${count} sampled frames of "${title}" (${ctx.filmId}) and repair what is wrong

Stills (1920x1080, every ${stride}th frame) are rendered once in .frames/${ctx.filmId}/judge/; videos/${ctx.filmId}/design/judge/manifest.json lists each one with its shot, narration and on-screen copy. Over MCP, call aideos_frame_stills to receive them as images. Do this for every sample, in one round:
1. Critique the still against its shot's narration: your own opinions, and concrete suggestions (each one a change you would make).
2. Repair the design where a frame is wrong: edit design/design.json and visuals/, then run \`aideos design build ${ctx.filmId}\` (or aideos_design_build) until it prints PASS. Only a passing build writes the film.
3. Score the frame as it is after your repair against its narration as an image-text similarity from 0 (unrelated) to 1 (exactly this).
4. Submit with aideos_submit_frame_review: {filmId, samples: [{frame, note, suggestions, similarity, repaired}]}, or write videos/${ctx.filmId}/design/judge/agent-report.json.
A text-only judge (Jev) then rules on every frame and rates every suggestion, so leave no sample out.${opts.customInstruction ? `\n\nFix these first, exactly as reported:\n${opts.customInstruction}` : ""}`;
  }
  const audioRef = ctx.voiceoverPath || `videos/${ctx.filmId}/voiceover.wav`;
  const durationText = ctx.durationSec !== undefined ? `${ctx.durationSec.toFixed(1)}s` : "measured";
  const shotsText = ctx.shotCount !== undefined ? `${ctx.shotCount} shots` : "compiled shots";

  let eventHeadline = 'The human clicked "Auto-Build Scenes from Script"';
  if (opts.eventType === "voiceover_ready") {
    eventHeadline = `Voiceover audio synthesized (${durationText})`;
  } else if (opts.eventType === "script_updated") {
    eventHeadline = "Screenplay updated in Studio";
  } else if (opts.eventType === "canvas_updated") {
    eventHeadline = opts.customInstruction || "Studio canvas nodes or spatial map updated";
  } else if (opts.eventType === "critique") {
    eventHeadline = opts.customInstruction ? `Review critique: "${opts.customInstruction}"` : "Review Critique submitted in Studio";
  } else if (opts.eventType === "ai_edit") {
    eventHeadline = opts.customInstruction ? `AI Edit requested: "${opts.customInstruction}"` : "AI video editing program requested";
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

${RUBRIC_SUMMARY}

🎯 Directing Mission for Agent:
1. Read \`videos/${ctx.filmId}/design/LOOK_BRIEF.md\` and write or update
   \`videos/${ctx.filmId}/design/look.json\` first. Run the look check before making pictures.
2. Review docs/DIRECTOR_GUIDE.md, then read the screenplay in ${ctx.scriptPath} and inspect
   ${ctx.filmPath}.
3. Build one persistent scene stage. Choose each shot's treatment from the look plan and make
   carried objects visibly change with the narration.
4. Use an inset for a precise device (TokenStrip, MatrixGrid, LayerStack, Plot, ScaleBar, or
   Distribution) only when the stage remains visible, or redraw its parts as SVG under
   videos/${ctx.filmId}/visuals/. Never paint a full panel or card over the stage.
5. Keep shot durations locked to narration audio, then run \`aideos design build ${ctx.filmId}\`
   and \`npm run validate:film ${ctx.filmPath}\` until both pass.
6. If using MCP, call \`aideos_claim_task\` to acknowledge and \`aideos_complete_task\` when done.
7. The live studio at http://localhost:3001 hot-reloads automatically as you edit.`;
}
