/**
 * File Description: Drives the real production pipeline on the committed iona-receive fixture's look and design with tone narration and no GPU engine, so a journey test gets a finished 3D-stage film without any model, key or login.
 * Inputs and outputs: render options (frame window, formats, stop stage) -> a ProductionResult plus the slug of the throwaway package it was built in.
 * Used by: backend/journeys/*.journey.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { runProduction } from "../pipeline/run";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import type { ProductionRequest, ProductionResult } from "../pipeline/types";

const FIXTURE = path.resolve(__dirname, "../../test_fixtures/packages/iona-receive");
/** A design or look plan edited as loose JSON, so a test can break any field at any depth. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the point of this type is to be indexable at any depth
export type Loose = Record<string, any>;

/** The fixture's shot ids and the beat ids intake gives the same three narration beats. */
const BEAT_IDS: Record<string, string> = { approach: "beat-01", catch: "beat-02", receipt: "beat-03" };

/**
 * The fixture's three narration beats, padded so tone narration (about 0.4 s a word) reaches the
 * 10 s the film schema asks for. "catches" and the other cue phrases the fixture's look and design
 * bind to are kept verbatim, so the contact moment still lands on the spoken word.
 */
export const IONA_BEATS = [
  "A message travels toward Iona. It drifts slowly across the quiet room toward her waiting hands.",
  "She catches the illustrative message. Her hands close around its folded paper wings and hold it.",
  "Receipt still needs an acknowledgment. The note is held, but nobody has confirmed that anyone read it.",
];

/** Screenplay text for the three beats, in the tagged format the intake stage parses. */
export function ionaScript(beats: string[] = IONA_BEATS): string {
  return beats.map((text, i) => `## 0:0${i} - beat ${i + 1}\n[NARRATION] ${text}\n[VISUAL] A persistent stage with Iona and a paper glider.`).join("\n\n");
}

/** Replaces every string value equal to a fixture shot id with the matching beat id, at any depth. */
export function retargetShotIds<T>(value: T): T {
  if (typeof value === "string") return (BEAT_IDS[value] ?? value) as T;
  if (Array.isArray(value)) return value.map(retargetShotIds) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retargetShotIds(v)])) as T;
  return value;
}

/** Writes the fixture's look plan, design and background art into the package, addressed to the intake beat ids. */
export function writeIonaDesign(slug: string, edit: (design: Loose) => void = () => undefined, editLook: (look: Loose) => void = () => undefined): void {
  const pkg = path.join(getVideosDir(), slug);
  fs.mkdirSync(path.join(pkg, "design"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "visuals"), { recursive: true });
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(FIXTURE, file), "utf8")) as Loose;
  const design = retargetShotIds(read("design/design.json"));
  edit(design);
  const look = retargetShotIds(read("design/look.json"));
  editLook(look);
  fs.writeFileSync(path.join(pkg, "design/look.json"), JSON.stringify(look));
  fs.writeFileSync(path.join(pkg, "design/design.json"), JSON.stringify(design));
  fs.copyFileSync(path.join(FIXTURE, "visuals/canvas.svg"), path.join(pkg, "visuals/canvas.svg"));
}

/** The request every journey shares (the Iona screenplay unless overridden): tone voice, no engine, no live agent, no server model; AIDEOS_BROWSER_EXECUTABLE renders with a local Chrome. */
export function journeyRequest(slug: string, overrides: Partial<ProductionRequest> = {}): ProductionRequest {
  return {
    script: ionaScript(),
    title: "Iona receives a message",
    slug,
    ttsBackend: "tone",
    brollEngine: "null",
    broll: false,
    skipAgent: true,
    deviceCaller: null,
    designLlmCaller: async () => {
      throw new Error("a journey must never call a server model");
    },
    syncToPreview: false,
    renderConcurrency: 2,
    // A host without Remotion's downloaded headless shell can point renders at a local Chrome.
    ...(process.env.AIDEOS_BROWSER_EXECUTABLE ? { browserExecutable: process.env.AIDEOS_BROWSER_EXECUTABLE } : {}),
    ...overrides,
  };
}

/** What an Iona production leaves behind, plus the frame the receive lands on. */
export interface IonaProduction {
  result: ProductionResult;
  /** Film frame of the decisive "catches" contact, read from the compiled film. */
  contactFrame: number;
}

/**
 * Runs the real author-then-resume flow: the first run stops at the look brief, the fixture look
 * and design are written and checked with `buildDesign`, and the same request then continues. A
 * `windowFrames` of N renders only the contact frame plus and minus N, so a journey costs seconds.
 */
export async function produceIona(
  slug: string,
  options: { request?: Partial<ProductionRequest>; windowFrames?: number; design?: (d: Loose) => void } = {},
): Promise<IonaProduction> {
  const request = journeyRequest(slug, options.request);
  const first = await runProduction({ ...request, stopAfter: "look" });
  if (first.status !== "needs_look") throw new Error(`expected the first run to stop at needs_look, got ${first.status}`);
  writeIonaDesign(slug, options.design);
  const built = buildDesign(slug, "hand-built");
  if (built.state !== "passed") throw new Error(`the fixture design did not pass its own checks: ${JSON.stringify(built)}`);
  const contactFrame = readFilm(slug)!.scene!.performances![0].decisive.frame;
  const renderFrames: [number, number] | undefined = options.windowFrames === undefined ? request.renderFrames : [contactFrame - options.windowFrames, contactFrame + options.windowFrames];
  return { result: await runProduction({ ...request, renderFrames }), contactFrame };
}
