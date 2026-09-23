/**
 * File Description: Writes the design brief a designer (the connected agent or the server model)
 * works from: what the film says shot by shot, the standard layer every design must meet, the
 * design.json format with a worked example, and the commands that build and check it. The brief is
 * the whole contract, so a designer needs nothing else to produce a passing bespoke design.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFilm, type Film } from "../../src/dl/schema";
import { FORMAT_WINDOWS, SAFE_SQUARE, SCENE_SIZE } from "../sceneKit";
import { LOCKED_PALETTE } from "../designCheck/designCheck";
import { designDir } from "./build";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** A small but complete design.json, shown to the designer as the shape to follow. */
export const EXAMPLE_SPEC = {
  brief: {
    concept: "One lamp in a dark room stands for the model's attention: where it points is what the model sees.",
    throughLine: "The lamp's beam, which sweeps across tokens on every beat.",
    motifs: ["beam", "tokens as tiles"],
  },
  accent: "#635BFF",
  assets: [
    { id: "lamp", file: "visuals/lamp.svg", position: [960, 1180], scale: 1.6, layer: 2 },
    { id: "tiles", file: "visuals/tiles.svg", position: [960, 820], scale: 2, layer: 1 },
  ],
  clips: [
    { id: "lamp-in", asset: "lamp", targets: ["lamp"], property: "opacity", from: 0, to: 1, start: "intro", end: "intro@0.2", easing: "expoOut" },
    { id: "beam-draw", asset: "lamp", targets: ["beam"], property: "drawOn", from: 0, to: 1, start: 'intro:"attention"', end: 'intro:"attention"@end+12', easing: "expoOut" },
    { id: "tiles-in", asset: "tiles", targets: ["tile-1", "tile-2", "tile-3"], property: "opacity", from: 0, to: 1, start: "how-it-works", end: "how-it-works@0.3", stagger: 6 },
    { id: "beam-swing", asset: "lamp", targets: ["beam"], property: "rotate", from: 0, to: 24, start: 'how-it-works:"next word"', end: "how-it-works@end", origin: [0, -40], easing: "expoInOut" },
  ],
};

// Formats seconds as m:ss.
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Renders the brief markdown for a film.
export function renderDesignBrief(film: Film): string {
  let t = 0;
  const shots = film.shots
    .map((s) => {
      const line = `- \`${s.id}\` (${clock(t)}-${clock(t + s.dur)}, ${s.dur.toFixed(1)}s, chapter "${s.ch}")\n  - says: ${s.scriptText?.trim() || "(no narration)"}${s.visualDirection ? `\n  - direction: ${s.visualDirection}` : ""}${s.blocks.length ? `\n  - on screen now: ${s.blocks.map((b) => b.c).join(", ")}` : ""}`;
      t += s.dur;
      return line;
    })
    .join("\n");

  return `# Design brief: ${film.title} (\`${film.id}\`)

Design this film's picture from scratch, as one continuous vector scene unique to this film. Write
\`videos/${film.id}/design/design.json\` and the SVG artwork it names in \`videos/${film.id}/visuals/\`,
then run \`aideos design build ${film.id}\` and fix whatever it reports until it prints PASS. A failing
build never touches the film, so iterate freely. The worked example of a finished scene film is
\`videos/still-talking/\` (built by \`backend/stillTalking/scene.ts\` on the same kit).

## The standard layer (enforced by the build)

- **Palette:** only ${LOCKED_PALETTE.join(", ")} (and their alpha versions) plus the film's one \`accent\`. Greys, black and white are fine. The accent is used sparingly: at most three accented things per frame.
- **Type:** Geist for words, JetBrains Mono for numbers, code and labels. No other typeface.
- **Artwork:** each asset is a static SVG with \`viewBox="-300 -200 600 400"\` and \`preserveAspectRatio="xMidYMid meet"\`, drawn centred on 0,0. No \`<script>\`, \`<animate>\`, \`<foreignObject>\`, CSS animation or remote links. Give an \`id\` to every element you will move. Motion lives only in clips.
- **Stage:** the scene is ${SCENE_SIZE.w} x ${SCENE_SIZE.h}; \`position\` is where an asset's centre sits. The wide cut sees y ${FORMAT_WINDOWS.wide.y0}-${FORMAT_WINDOWS.wide.y1}; the reel sees x ${FORMAT_WINDOWS.reel.x0}-${FORMAT_WINDOWS.reel.x1}. Everything essential lives in the safe square (${SAFE_SQUARE.x0}-${SAFE_SQUARE.x1} on both axes). Headlines (TextReveal cards) are drawn centred across the middle of the frame, roughly scene y 860-1060 in the wide cut, so keep that band free of artwork and labels. Keep the bottom band clear of detail that fights the captions.
- **Shots:** a shot staged "anchor" (a chart such as StatCounter or TokenStrip) draws an opaque panel over your scene. Prefer text cards so the scene stays in view, and use \`shots\` to replace any chart whose numbers the narration does not say.
- **Continuity:** one scene for the whole film. Base elements stay on screen and evolve; new elements build on what is there (no disconnected frames). A clip must start from the value the previous clip on that element and property left (the build names the clip when it does not). To jump, hide the element first and set \`allowJump\`. One element keeps one transform \`origin\` for the whole film.
- **Timing:** never write frames. Cue every clip to the narration: \`"shot"\`, \`"shot@0.4"\`, \`"shot@end"\`, \`'shot:"spoken phrase"'\`, \`'shot:"spoken phrase"@end'\`, \`"end"\`, each optionally \`+N\`/\`-N\` frames. Aim at the word being said: every visual depicts what is spoken at that moment. A cue naming a phrase that is not spoken in that shot fails the build.
- **Honest data:** any number, label or chart on screen must come from the narration. A counter must show a number that is actually said.

## design.json

\`\`\`json
${JSON.stringify(EXAMPLE_SPEC, null, 2)}
\`\`\`

- \`brief\` records the idea (shown in the studio). \`accent\` is optional (#rrggbb).
- \`background\` (optional): \`{ "file": "visuals/<name>.svg", "scale": 4.8 }\` fills the stage; omit for the plain canvas.
- \`assets[]\`: \`id\`, \`file\`, \`position\` [x, y], \`scale\`, optional \`layer\` (higher draws on top), \`rotation\`, \`opacity\`.
- \`clips[]\`: \`property\` is one of translateX, translateY, scale, scaleX, scaleY, rotate, opacity, drawOn. \`stagger\` delays each further target by N frames. \`origin\` is [x, y] in the asset's own coordinates.
- \`shots\` (optional): \`{ "<shot id>": { "blocks": [...], "stage": "frame" } }\` replaces the cards drawn over the scene for that shot (film schema blocks, at most 4). Text-only blocks default to stage "frame" (scene stays visible), no blocks to "none". Use it to remove a chart the narration does not support or to write your own card.

## What the film says

${shots}

## Commands

- \`aideos design build ${film.id}\`: compile, check, and write the film when it passes. Result also in \`videos/${film.id}/design/status.json\`.
- \`aideos design check ${film.id} --stills\`: re-check and render review stills into \`.frames/${film.id}/\`. Look at them: fix anything that reads badly, collides with captions, or is off the safe square.
`;
}

// Writes design/BRIEF.md for a film and returns its path.
export function writeDesignBrief(filmId: string): string {
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "videos", filmId, "film.json"), "utf8")));
  const dir = designDir(filmId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "BRIEF.md");
  fs.writeFileSync(file, renderDesignBrief(film));
  return file;
}
