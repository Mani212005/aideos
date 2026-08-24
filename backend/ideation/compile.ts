/**
 * File Description: Deterministic compilation of staged artifacts into a final
 * film and an engine-ready VideoJobSpec batch (report section 4 step 5).
 * No model calls here: layout, edges and prompt assembly are pure code so the
 * handoff from reviewable JSON to render is reproducible.
 */
import { parseFilm } from "../../src/dl/schema";
import type { Film } from "../../src/dl/schema";
import type { VideoJobSpec } from "../engine/types";
import type { PromptsFile, Shotlist, Treatment } from "./schemas";

/**
 * Assign canvas coordinates left-to-right with a gentle vertical stagger.
 * The model never invents numbers; node order in the shot list is the layout.
 */
export function layoutNodes(nodes: { id: string; label: string; sub?: string }[]): Film["canvas"]["nodes"] {
  const spanX = nodes.length > 1 ? 1700 : 0;
  return nodes.map((n, i) => ({
    id: n.id,
    label: n.label,
    ...(n.sub ? { sub: n.sub } : {}),
    x: Math.round(150 + (nodes.length > 1 ? (i / (nodes.length - 1)) * spanX : 0)),
    y: 420 + (i % 3) * 80,
    w: 190,
    h: 62,
  }));
}

/**
 * Compile the edge list: a sequential spine through node order plus any extra
 * edges the shot list declared. The spine guarantees at least one edge exists
 * without asking the model for boilerplate.
 */
export function compileEdges(sl: Shotlist): Film["canvas"]["edges"] {
  const spine = sl.nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: sl.nodes[i + 1].id }));
  const extras = sl.extraEdges.map((e) => ({
    from: e.from,
    to: e.to,
    ...(e.dashed !== undefined ? { dashed: e.dashed } : {}),
    ...(e.label ? { label: e.label } : {}),
  }));
  return [...spine, ...extras];
}

/**
 * Build the final Film from treatment + gated shot list. The pacing rules ran
 * at the shoot stage already; this runs parseFilm once more as a defensive
 * final check before anything is written or installed.
 */
export function compileFilm(treatment: Treatment, shotlist: Shotlist): Film {
  const film = parseFilm({
    id: shotlist.id,
    title: treatment.title,
    fps: shotlist.fps,
    chapters: shotlist.chapters,
    canvas: {
      nodes: layoutNodes(shotlist.nodes),
      edges: compileEdges(shotlist),
    },
    shots: shotlist.shots.map((s) => ({
      id: s.id,
      ...(s.ch ? { ch: s.ch } : {}),
      dur: s.dur,
      move: s.move,
      stage: s.stage,
      look: s.look,
      drift: s.drift,
      zoom: s.zoom,
      ...(s.scriptText ? { scriptText: s.scriptText } : {}),
      ...(s.visualDirection ? { visualDirection: s.visualDirection } : {}),
      ...(s.transition ? { transition: s.transition } : {}),
      blocks: s.blocks,
    })),
  });
  return film;
}

/**
 * Collect character sheets whose name appears in the given text, verbatim.
 * Consistency rule (report section 4): a named entity's frozen description
 * paragraph travels with every prompt that mentions it, word for word.
 */
export function applicableCharacterSheets(treatment: Treatment, text: string): string[] {
  const lower = text.toLowerCase();
  return treatment.characters
    .filter((c) => lower.includes(c.name.toLowerCase()))
    .map((c) => `${c.name}: ${c.description}`);
}

/**
 * Assemble the final text-to-video prompt for one shot: shared style block
 * first, then any matching character sheets, then the model's core clip
 * description. Image-to-video reference frames are out of scope for now (the
 * 8 GB VRAM budget cannot fit them); this plain-T2V assembly is the seam where
 * a reference-frame prefix would slot in later.
 */
export function assembleFootagePrompt(treatment: Treatment, corePrompt: string, contextText: string): string {
  const parts = [treatment.styleBlock.trim(), ...applicableCharacterSheets(treatment, contextText), corePrompt.trim()];
  return parts.join("\n\n");
}

/**
 * Turn needsFootage shots plus the prompts file into engine job specs.
 * Throws if a flagged shot has no prompt or a prompt names no flagged shot:
 * either side drifting silently would mean b-roll quietly missing from the cut.
 */
export function extractJobSpecs(
  treatment: Treatment,
  shotlist: Shotlist,
  prompts: PromptsFile | null,
): { spec: VideoJobSpec; shotId: string }[] {
  const flagged = shotlist.shots.filter((s) => s.needsFootage);
  const flaggedIds = new Set(flagged.map((s) => s.id));
  for (const p of prompts?.prompts ?? []) {
    if (!flaggedIds.has(p.shotId))
      throw new Error(`prompts file has an entry for "${p.shotId}" but that shot does not need footage`);
  }
  const byId = new Map((prompts?.prompts ?? []).map((p) => [p.shotId, p]));
  return flagged.map((shot) => {
    const item = byId.get(shot.id);
    if (!item)
      throw new Error(`shot "${shot.id}" needs footage but the prompts file has no entry for it`);
    const context = `${shot.scriptText ?? ""} ${shot.visualDirection ?? ""}`;
    return {
      shotId: shot.id,
      spec: {
        // WanGP treats blank lines as separate generation requests (PG mode),
        // so the engine-bound prompt is always collapsed to a single line.
        prompt: assembleFootagePrompt(treatment, item.prompt, context).replace(/\s*\n+\s*/g, " ").trim(),
        ...(item.negativePrompt ? { negativePrompt: item.negativePrompt } : {}),
        seconds: shot.footageSeconds,
        width: 832,
        height: 480,
        fps: 16,
        // Wan2.1 T2V-1.3B quantized profile: the only one that fits the box's
        // 8 GB budget today (see backend/engine/profiles/small.json).
        modelProfile: "small" as const,
      },
    };
  });
}
