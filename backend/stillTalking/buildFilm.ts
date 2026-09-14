/**
 * File Description: Builds the "Still Talking" video package from its beat sheet and its narration.
 * Writes the vector artwork, derives every shot's frame span from the measured voiceover, attaches
 * the film's single animated scene, validates the result against both the film schema and the scene
 * engine's own node-side validator, and then writes the two files that must never drift apart:
 * videos/still-talking/film.json and its generated shadow src/dl/films/still-talking.ts.
 */

import * as fs from "fs";
import * as path from "path";
import { parseFilm, type Film, type Shot } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import { validateSceneWithNodeAssets } from "../../src/dl/scene/validateSceneNode";
import { compileScene } from "../../src/dl/scene/compile";
import { loadSceneAssets } from "../scene/loadSceneAssets";
import { buildSvgSources } from "../scene/buildSvgSources";
import { BEATS, CHAPTERS } from "./beats";
import { buildScene, shotFrames, FPS } from "./scene";
import { readVoiceoverTiming } from "./produceVoiceover";
import { writeAssets } from "./writeAssets";

const FILM_ID = "still-talking";

/** One line of visual direction per shot, kept in the manifest so the picture explains itself. */
const VISUAL_DIRECTION: Record<string, string> = {
  departure: "Wide starfield. The craft is small, dish already turned back toward the sun. The signal thread draws itself home for the first time.",
  "one-job": "Push in. Three booms swing out and lock. The instrument lamps light in the order they were switched on.",
  "not-coming-back": "The orbit rings draw themselves outward from the sun. Earth pings on the first ring. Nothing loops back.",
  "the-record": "The disc on the craft's flank grows into frame. One continuous groove traces itself from the outside in while the record turns.",
  "let-go": "Pull back fast. The record shrinks to a speck on a craft that is suddenly very small.",
  "falling-outward": "Sustained drift. The sun shrinks. Pulses travel the thread toward it, steady as a heartbeat.",
  jupiter: "Jupiter arrives and looms until its limb runs off both edges. The cloud bands shear against each other. The storm turns.",
  slingshot: "The craft whips outward and the whole star field accelerates with it. Jupiter slides off frame unmoved.",
  saturn: "Saturn arrives with its rings drawing themselves on. Titan's atmosphere lights as the craft swings past it.",
  "out-of-plane": "The orbit rings flatten into a single line and fall away below as the craft climbs out of the plane of the planets.",
  "nothing-but-distance": "Held drift. Nothing enters frame. The emptiest shot in the film.",
  "turn-around": "The camera boom swings all the way round to look back the way it came. The dish never leaves the sun.",
  "sixty-photographs": "Sixty plates fill in one after another under a sweeping scan line. The shutter blinks on the instrument lamps.",
  "pale-blue-pixel": "One plate is marked, and the frame dives into it. A reticle closes on a single accent-coloured speck inside a stray sunbeam.",
  "that-is-everyone": "Hold on the speck. The slowest push in the film. It pings twice, then stops.",
  "eyes-closed": "The reticle releases. The camera lamps go out one after another and the boom swings back to its heading.",
  "particles-change": "A boundary arc appears far ahead on the right and begins to draw itself across the frame.",
  "last-breath": "The solar wind streamers decelerate to a dead stop and fade. Outside the arc, a colder and denser field arrives.",
  "across-the-edge": "The craft crosses the arc. It closes behind and recedes. The sun is now indistinguishable from the other stars.",
  "still-out-there": "Wide and quiet. The craft alone, the thread still attached, running off the left edge of frame.",
  "twenty-two-watts": "The heartbeat stops. One pulse leaves the dish alone and travels the whole thread, thinning the whole way.",
  "going-dark": "The instrument lamps go out one at a time. The radio lamp on the bus is left burning by itself.",
  "the-last-one": "The radio lamp dims to nothing. The signal thread stops drawing partway across the frame.",
  "keep-going": "The thread is gone. The craft keeps moving at exactly the rate it always has, out toward frame right.",
  "longer-than-the-sun": "The record on its flank catches one last highlight. The frame settles to stars.",
};

/** Shots with a chapter change open on a cut, which is what the chapter rail counts. */
function buildShots(spans: Map<string, { from: number; to: number }>): Shot[] {
  let lastChapter: string | null = null;
  return BEATS.map((beat) => {
    const span = spans.get(beat.id);
    if (!span) throw new Error(`No measured narration for beat "${beat.id}".`);
    const isChapterOpening = beat.chapter !== lastChapter;
    lastChapter = beat.chapter;
    return {
      id: beat.id,
      ch: beat.chapter,
      dur: Number(((span.to - span.from) / FPS).toFixed(4)),
      look: "all",
      move: isChapterOpening ? "cut" : "pan",
      // A shot with text raises a card over the film; a shot without it is pure picture, which is
      // also what returns the runsheet to the canvas.
      stage: beat.blocks.length > 0 ? "frame" : "none",
      drift: false,
      zoom: 1,
      scriptText: beat.narration,
      visualDirection: VISUAL_DIRECTION[beat.id] ?? "",
      blocks: beat.blocks,
    } as Shot;
  });
}

/** Assembles the complete film manifest around its scene and its measured narration. */
export function buildFilm(): { film: Film; scene: Scene } {
  const timing = readVoiceoverTiming();
  const { spans, durationFrames } = shotFrames(timing);
  const scene = buildScene(timing);

  const film = parseFilm({
    schemaVersion: "1.0.0",
    id: FILM_ID,
    title: "Still Talking",
    fps: FPS,
    accent: "#635BFF",
    theme: {
      background: "smooth-dark",
      fontFamily: "geist",
      videoType: "educational",
      storyStyle: "script-metaphor",
      accent: "#635BFF",
    },
    chapters: [...CHAPTERS],
    // A scene film draws its canvas from the scene below, not from this graph. The spine is kept
    // honest and minimal so the manifest still says, in words, what the film travels through.
    canvas: {
      nodes: [
        { id: "sun", label: "the sun", sub: "where the signal is aimed", x: 60, y: 300, w: 200, h: 62 },
        { id: "heliopause", label: "the heliopause", sub: "august 2012", x: 400, y: 300, w: 210, h: 62 },
        { id: "interstellar", label: "interstellar space", sub: "still transmitting", x: 750, y: 300, w: 230, h: 62 },
      ],
      edges: [
        { from: "sun", to: "heliopause", dashed: false },
        { from: "heliopause", to: "interstellar", dashed: true },
      ],
    },
    scene,
    shots: buildShots(spans),
    // The film writes its own cards; a second line of burned-in type would fight them.
    subtitles: false,
    voiceover: {
      src: "videos/still-talking/voiceover.wav",
      volume: 1,
      durationSec: Number((durationFrames / FPS).toFixed(4)),
    },
  });

  return { film, scene };
}

/** `still-talking` becomes `stillTalkingFilm`: film ids may carry dashes, identifiers may not. */
function exportName(id: string): string {
  return `${id.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase())}Film`;
}

/**
 * Renders the generated shadow module exactly as editor/vite.config.ts writes it.
 * The manifest and its shadow are only ever written together, which is the one rule that stops
 * the two from drifting apart.
 */
function filmModule(film: Film): string {
  return `import type { Film } from "../schema";\n\nexport const ${exportName(film.id)}: Film = ${JSON.stringify(film, null, 2)};\n`;
}

/** Builds everything and writes it to disk, failing on any validation the engines can do for us. */
export function buildPackage(): void {
  const root = path.resolve(__dirname, "../..");

  writeAssets();
  const { film, scene } = buildFilm();

  // The scene engine's own node-side validator reads every asset off disk and rejects a clip that
  // names an element the document does not declare. Compiling proves the whole film can be drawn.
  const validation = validateSceneWithNodeAssets(scene);
  if (!validation.isValid) {
    throw new Error(
      `Scene invalid:\n${validation.errors.map((e) => `  [Rule ${e.rule}] ${e.message}`).join("\n")}`,
    );
  }
  const assets = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });

  fs.writeFileSync(
    path.join(root, "videos", FILM_ID, "film.json"),
    `${JSON.stringify(film, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(root, "src/dl/films", `${FILM_ID}.ts`), filmModule(film), "utf8");
  fs.writeFileSync(
    path.join(root, "src/dl/activeFilm.ts"),
    `import { ${exportName(FILM_ID)} } from "./films/${FILM_ID}";\nimport type { Film } from "./schema";\n\nexport const ACTIVE_FILM: Film = ${exportName(FILM_ID)};\n`,
    "utf8",
  );
  buildSvgSources();

  const clipCount = [scene.background, ...scene.props].reduce(
    (sum, asset) => sum + (asset.animation?.clips.length ?? 0),
    0,
  );
  console.log(
    `[still-talking] ${film.shots.length} shots, ${scene.durationFrames} frames ` +
      `(${(scene.durationFrames / FPS).toFixed(1)}s), ${scene.props.length + 1} assets, ${clipCount} animation clips.`,
  );
  if (compiled.meta.warnings.length > 0) {
    console.log(`[still-talking] scene warnings: ${compiled.meta.warnings.join("; ")}`);
  }
}

if (require.main === module) {
  buildPackage();
}
