/**
 * File Description: Loads reel authoring inputs and writes the condensed-narration writer's brief.
 * Inputs and outputs: package slug and explicit budget -> checked package inputs and reel/REEL_BRIEF.md.
 * Used by: aideos reel brief/check and the production reel writer.
 */
import fs from "node:fs";
import path from "node:path";
import { parseFilm } from "../../src/dl/schema";
import {
  getVideosDir,
  resolvePackageDir,
} from "../../src/dl/videoPackageLoader";
import { designSpecSchema } from "../designSpec/spec";
import { lookPlanSchema } from "../lookPlan/schema";
import { createReelContext, type ReelContext } from "./constraints";
import { parseReelBudget, type ReelBudget, type ReelCut } from "./schema";
import { visibleReelText } from "./visibleText";

export class ReelCutSceneFilmError extends Error {
  readonly code = "REEL_CUT_SCENE_FILMS_ONLY";

  // Initializes the stable CLI error contract for unsupported film packages.
  constructor() {
    super("reel cut supports scene films only; this package uses legacy actors");
    this.name = "ReelCutSceneFilmError";
  }
}

// Resolves a validated package slug without accepting arbitrary filesystem traversal.
export function reelPackageDir(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`invalid film id "${slug}"`);
  return resolvePackageDir(slug);
}

// Reads optional authoring JSON, distinguishing absence from corrupt or unreadable data.
function optionalJson(file: string): unknown {
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : undefined;
}

// Loads the authoritative long film and validates all available shared authoring inputs.
export function loadReelContext(slug: string): ReelContext {
  const pkg = reelPackageDir(slug);
  const film = parseFilm(
    JSON.parse(fs.readFileSync(path.join(pkg, "film.json"), "utf8")),
  );
  if (film.id !== slug)
    throw new Error(`package "${slug}" contains film "${film.id}"`);
  if (!film.scene || film.scene.actors.length) throw new ReelCutSceneFilmError();
  const design = optionalJson(path.join(pkg, "design/design.json"));
  const look = optionalJson(path.join(pkg, "design/look.json"));
  return createReelContext({
    film,
    design: design === undefined ? undefined : designSpecSchema.parse(design),
    look: look === undefined ? undefined : lookPlanSchema.parse(look),
    visibleText: visibleReelText(film),
  });
}

// Reads the sole editable reel source without ever writing or repairing it.
export function readReelCut(slug: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(reelPackageDir(slug), "reel/cut.json"), "utf8"),
  );
}

// Builds the complete writer interface with exact source hashes, locked text and measured speaking rate.
export function reelBrief(
  context: ReelContext,
  budgetInput: ReelBudget,
): string {
  const budget = parseReelBudget(budgetInput);
  const targetWords = Math.floor(
    (budget.targetSec - budget.endCardSec) * context.wordsPerSec,
  );
  const capWords = Math.floor(
    (budget.maxSec - budget.endCardSec) * context.wordsPerSec,
  );
  const scaffold: ReelCut = {
    schema: "aideos.reelcut/1",
    source: "agent",
    long: {
      shots: Object.fromEntries(context.shots.map((s) => [s.id, s.hash])),
    },
    shots: context.shots.map((s) => ({ id: s.id, narration: s.narration })),
  };
  return `# Reel narration brief: ${context.filmId}

Write reel/cut.json using schema aideos.reelcut/1. The picture, scenes, designs, voice and speed stay the same; condense only the narration.

Target delivered length: ${budget.targetSec.toFixed(1)} s. Hard cap: ${budget.maxSec.toFixed(1)} s, including ${budget.endCardSec.toFixed(1)} s of end card.
Story target: ${(budget.targetSec - budget.endCardSec).toFixed(1)} s. Story cap: ${(budget.maxSec - budget.endCardSec).toFixed(1)} s.
This long take measures ${context.wordsPerSec.toFixed(3)} words/s. Aim for at most ${targetWords} words; estimated hard ceiling ${capWords} words. These are estimates until synthesis measures the audio.

Rules:
- Include every long shot id exactly once, in order, with narration or {"id":"...","drop":true,"reason":"..."}.
- Condense evenly first. Drop the least load-bearing shots only when condensing cannot meet the budget. Every drop needs a reason.
- Keep the first-shot hook, last-shot payoff and every decisive performance. A dropped shot must later pass the reel design check without a visible snap.
- Keep every locked phrase verbatim under the cue matcher's case and punctuation normalization. Decisive phrases must occur exactly once in their shot.
- Condense, never add a fact or number. New content words will be flagged by \`aideos reel check\` for the captain's review. Every on-screen number in a kept shot must still be spoken there. The on-screen text below tells you which picture the narration must explain.
- Keep more narration when the estimate falls below a shot's motion floor. Floors come from the compiled long camera curve under uniform retiming; the compiled reel design check is the final authority at shot boundaries and phrase cues.
- Same voice and speed as the long. Nothing is automatically trimmed, accelerated or removed to fit.
- Keep long.shots hashes exactly as listed. If a long line changes, rewrite its reel line and refresh that hash.
- AI drafts may render before captain approval. Only the captain records approved: {"by":"captain","at":"<ISO timestamp>"}; approval is optional and never gates rendering.

${context.shots
  .map(
    (s, i) => `## ${i + 1}. ${s.id}

Long measured shot: ${s.longSec.toFixed(2)} s. Minimum motion time: ${s.minSec.toFixed(2)} s.${i === 0 ? " Keep the hook." : ""}${i === context.shots.length - 1 ? " Keep the payoff." : ""}${s.decisive ? " Decisive performance: keep this shot." : ""}
Long narration: ${s.narration}
Locked phrases: ${s.locks.length ? s.locks.map((l) => `${JSON.stringify(l.phrase)}${l.unique ? " (exactly once)" : ""} [${l.source}]`).join("; ") : "none"}
On-screen text: ${s.onScreenText.length ? s.onScreenText.map((t) => JSON.stringify(t)).join("; ") : "none"}
On-screen numbers to speak: ${s.onScreenNumbers.join(", ") || "none"}
`,
  )
  .join("\n")}
## Starting cut (replace the long lines with condensed narration)

\`\`\`json
${JSON.stringify(scaffold, null, 2)}
\`\`\`

Validate with: aideos reel check ${context.filmId} --max-sec ${budget.maxSec} --target-sec ${budget.targetSec}
`;
}

// Writes only the generated brief, leaving the long package and any owner-authored cut untouched.
export function writeReelBrief(slug: string, budget: ReelBudget): string {
  const pkg = reelPackageDir(slug);
  const personalPkg = path.join(getVideosDir(), slug);
  if (path.resolve(pkg) !== path.resolve(personalPkg))
    throw new Error(`cannot write a reel brief for read-only example "${slug}"`);
  const body = reelBrief(loadReelContext(slug), budget);
  const dir = path.join(pkg, "reel");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "REEL_BRIEF.md");
  fs.writeFileSync(file, body, "utf8");
  return file;
}
