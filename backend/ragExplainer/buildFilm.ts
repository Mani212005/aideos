/**
 * File Description: Builds the "RAG, in four steps" video package from its beat sheet and its narration.
 * Every scene builder authors one SVG asset plus its animation timeline from the measured shot spine;
 * this module writes the artwork, assembles the single Scene that runs the whole film, validates it
 * against the film schema and the scene engine, and writes film.json with its generated shadow module
 * together through the project's film store.
 */

import * as path from "path";
import { parseFilm, type Film, type Shot } from "../../src/dl/schema";
import type { EnvironmentAsset, Scene } from "../../src/dl/scene/types";
import { validateSceneWithNodeAssets } from "../../src/dl/scene/validateSceneNode";
import { compileScene } from "../../src/dl/scene/compile";
import { writeFilm, setActiveFilm } from "../pipeline/filmStore";
import { loadSceneAssets } from "../scene/loadSceneAssets";
import { buildSvgSources } from "../scene/buildSvgSources";
import { FPS, SCENE_SIZE, shotFrames, writeSvgAssets } from "../sceneKit";
import { BEATS, CHAPTERS } from "./beats";
import { BEAT_BPM, beatSeconds } from "./beatGrid";
import { readVoiceoverTiming, type VoiceoverTiming } from "./produceVoiceover";
import { Canvas } from "./kit";
import { backdropSvg, buildHud } from "./scenes/common";
import { buildLiar } from "./scenes/liar";
import { buildFix } from "./scenes/fix";
import { buildFlow, stuffFrames } from "./scenes/flow";
import { buildGround } from "./scenes/ground";
import { buildFail } from "./scenes/fail";
import { buildOutro } from "./scenes/outro";

const FILM_ID = "rag-explainer";
const VISUALS = path.resolve(__dirname, "../../videos/rag-explainer/visuals");

/** One line of visual direction per shot, kept in the manifest so the picture explains itself. */
const VISUAL_DIRECTION: Record<string, string> = {
  stale: "A timeline of training data stops dead at a hard cutoff line.",
  invent: "Hollow question-mark answers pop into the empty space after the cutoff.",
  halluc: "Hallucination in giant type; a confidence bar runs to full against an accuracy bar that cannot be measured.",
  nexttoken: "A terminal panel types the question and shows the model picking the most plausible wrong number.",
};

/** Builds every asset and the scene that layers them, in draw order. */
export function buildPackageScene(): { scene: Scene; timing: VoiceoverTiming; artwork: Record<string, string> } {
  const timing = readVoiceoverTiming();
  const { durationFrames } = shotFrames(timing);

  const liar = buildLiar(timing, durationFrames);
  const fix = buildFix(timing, durationFrames);
  const flow = buildFlow(timing, durationFrames);
  const ground = buildGround(timing, durationFrames);
  const fail = buildFail(timing, durationFrames);
  const outro = buildOutro(timing, durationFrames);
  const hud = new Canvas("hud", timing, durationFrames);
  const ctxLabels = ["0214", "0508", "0831", "1204"];
  const beatFrames: number[] = [];
  for (let b = 0; Math.round(b * beatSeconds() * FPS) < durationFrames - 14; b++) beatFrames.push(Math.round(b * beatSeconds() * FPS));
  buildHud(hud, [
    { label: "CONTEXT 0000 / 8192", frame: 0 },
    ...stuffFrames(timing).map((frame, j) => ({ label: `CONTEXT ${ctxLabels[j]} / 8192`, frame: frame + 8 })),
  ], { bpm: BEAT_BPM, beatFrames });

  const layers: Array<{ id: string; canvas: Canvas; layer: number }> = [
    { id: "liar", canvas: liar, layer: 2 },
    { id: "fix", canvas: fix, layer: 4 },
    { id: "flow", canvas: flow, layer: 6 },
    { id: "ground", canvas: ground, layer: 8 },
    { id: "fail", canvas: fail, layer: 10 },
    { id: "outro", canvas: outro, layer: 12 },
    { id: "hud", canvas: hud, layer: 20 },
  ];
  const artwork: Record<string, string> = { "backdrop.svg": backdropSvg() };
  for (const l of layers) artwork[`${l.id}.svg`] = l.canvas.svg();

  const place = (assetId: string, layer: number, canvas?: Canvas): EnvironmentAsset => ({
    assetId,
    svgSource: `videos/rag-explainer/visuals/${assetId}.svg`,
    layer,
    position: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    opacity: 1,
    ...(canvas ? { animation: canvas.timeline() } : {}),
  });

  const scene: Scene = {
    schemaVersion: "1.0.0",
    sceneId: FILM_ID,
    fps: FPS,
    durationFrames,
    audioSource: "videos/rag-explainer/voiceover.wav",
    audioDurationMs: Math.round((durationFrames / FPS) * 1000),
    sceneSize: SCENE_SIZE,
    background: place("backdrop", 0),
    props: layers.map((l) => place(l.id, l.layer, l.canvas)),
    actors: [],
  };
  return { scene, timing, artwork };
}

/** Shots carry the narration and the chapter; the picture itself is the scene. */
function buildShots(spans: Map<string, { from: number; to: number }>): Shot[] {
  let lastChapter: string | null = null;
  return BEATS.map((beat) => {
    const span = spans.get(beat.id);
    if (!span) throw new Error(`No measured narration for beat "${beat.id}".`);
    const opening = beat.chapter !== lastChapter;
    lastChapter = beat.chapter;
    return {
      id: beat.id,
      ch: beat.chapter,
      dur: Number(((span.to - span.from) / FPS).toFixed(4)),
      look: "all",
      move: opening ? "cut" : "pan",
      stage: "none",
      drift: false,
      zoom: 1,
      scriptText: timingText(beat.id),
      visualDirection: VISUAL_DIRECTION[beat.id] ?? "",
      blocks: [],
    } as Shot;
  });
}

// The narrated text of one beat, straight from the beat sheet.
function timingText(id: string): string {
  return BEATS.find((b) => b.id === id)?.narration ?? "";
}

/** Assembles the film manifest around its scene and measured narration. */
export function buildFilm(): { film: Film; scene: Scene; artwork: Record<string, string> } {
  const { scene, timing, artwork } = buildPackageScene();
  const { spans, durationFrames } = shotFrames(timing);
  const film = parseFilm({
    schemaVersion: "1.0.0",
    id: FILM_ID,
    title: "RAG, in four steps",
    fps: FPS,
    accent: "#FF5A1F",
    theme: { background: "smooth-dark", fontFamily: "geist", videoType: "educational", storyStyle: "script-metaphor", accent: "#FF5A1F" },
    chapters: [...CHAPTERS],
    // A scene film draws its canvas from the scene below; the graph only says in words what it moves through.
    canvas: {
      nodes: [
        { id: "docs", label: "your documents", sub: "chunked and embedded", x: 60, y: 300, w: 220, h: 62 },
        { id: "retrieve", label: "top-k retrieval", sub: "nearest chunks to the question", x: 420, y: 300, w: 250, h: 62 },
        { id: "answer", label: "grounded answer", sub: "with a source", x: 820, y: 300, w: 220, h: 62 },
      ],
      edges: [
        { from: "docs", to: "retrieve", dashed: false },
        { from: "retrieve", to: "answer", dashed: false },
      ],
    },
    scene,
    shots: buildShots(spans),
    subtitles: false,
    voiceover: { src: "videos/rag-explainer/voiceover.wav", volume: 1, durationSec: Number((durationFrames / FPS).toFixed(4)) },
    // The stem is mastered hot and ducked line by line under the voice (beatTrack.py). Video.tsx would duck a
    // whole shot at a time and plays the track at this volume otherwise, so 0.25 sets the bed ~10 dB under speech.
    music: { src: "videos/rag-explainer/beat.wav", volume: 0.25, duckUnderVoiceover: false },
  });
  return { film, scene, artwork };
}

/** Builds everything and writes it to disk, failing on any validation the engines can do for us. */
export function buildPackage(): void {
  const { film, scene, artwork } = buildFilm();
  writeSvgAssets(VISUALS, artwork);
  const validation = validateSceneWithNodeAssets(scene);
  if (!validation.isValid) {
    throw new Error(`Scene invalid:\n${validation.errors.map((e) => `  [Rule ${e.rule}] ${e.message}`).join("\n")}`);
  }
  const assets = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });
  writeFilm(FILM_ID, film);
  setActiveFilm(FILM_ID);
  buildSvgSources();
  const clips = [scene.background, ...scene.props].reduce((sum, a) => sum + (a.animation?.clips.length ?? 0), 0);
  console.log(`[rag-explainer] ${film.shots.length} shots, ${scene.durationFrames} frames (${(scene.durationFrames / FPS).toFixed(1)}s), ${scene.props.length + 1} assets, ${clips} clips.`);
  if (compiled.meta.warnings.length > 0) console.log(`[rag-explainer] scene warnings: ${compiled.meta.warnings.join("; ")}`);
}

if (typeof require !== "undefined" && require.main === module) {
  buildPackage();
}
