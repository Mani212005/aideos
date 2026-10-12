/**
 * File Description: Writes LOOK_BRIEF.md for an Aideos film, instructing the agent or designer on the 6 look questions, the criteria for shot treatments, and the measured script beats.
 * Inputs and outputs: Film ID and package data -> LOOK_BRIEF.md markdown file in package design folder.
 * Used by: backend/cli.ts, backend/pipeline/run.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFilm, type Film } from "../../src/dl/schema";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";

// Formats seconds into m:ss clock format.
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Working example look plan structure shown in the brief. */
export const EXAMPLE_LOOK_PLAN = {
  schema: "aideos.look/1",
  decidedBy: {
    agent: "claude",
    model: "claude-sonnet-5-5",
    at: "2026-10-11T12:00:00Z",
    how: "designed from script beats",
  },
  film: {
    mode: "scene",
    stage: "One server rack seen from the front; data are tiles that move between shelves.",
    cast: [
      {
        id: "disk",
        what: "slow disk on the bottom shelf",
        enters: "beat-01",
        changes: [
          {
            at: "beat-03",
            how: "dims and slides left as the cache takes over",
            state: "disk dimmed on the left while cache serves requests",
            magnitude: "moderate",
          },
        ],
      },
      {
        id: "cache",
        what: "small fast box near the program",
        enters: "beat-02",
        changes: [
          {
            at: "beat-05",
            how: "becomes the cache card in the final flowchart",
            state: "cache card occupies the center of the final flow",
            magnitude: "major",
          },
        ],
      },
    ],
    camera: [
      { at: "beat-01", pose: "wide, establishing the server rack", why: "show the whole rack" },
      { at: "beat-02", pose: "push in to disk and memory bus", why: "focus on the slow read", focus: "disk" },
      { at: "beat-06", pose: "wide payoff showing the full data path", why: "payoff shows the whole path" },
    ],
    palette: {
      bg: "#0A0A0B",
      accent: "#635BFF",
    },
    captions: {
      position: "bottom",
      kineticColumn: false,
    },
    headlines: "none",
  },
  shots: [
    {
      id: "beat-01",
      treatment: "scene",
      carries: ["disk"],
      cue: "spinning",
      criterion: "1-mechanism",
      why: "the disk spinning is the claim",
    },
    {
      id: "beat-04",
      treatment: "device",
      device: "StatCounter",
      carries: ["disk", "cache"],
      cue: "faster",
      criterion: "3-precise-number",
      why: "the narrator says 100 times faster",
    },
  ],
  approval: {
    captain: null,
  },
};

// Renders the LOOK_BRIEF.md markdown for a film.
export function renderLookBrief(film: Film): string {
  let t = 0;
  const shotList = film.shots
    .map((s) => {
      const line = `- \`${s.id}\` (${clock(t)}-${clock(t + s.dur)}, ${s.dur.toFixed(1)}s, chapter "${s.ch}")\n  - says: ${s.scriptText?.trim() || "(no narration)"}${s.visualDirection ? `\n  - direction: ${s.visualDirection}` : ""}`;
      t += s.dur;
      return line;
    })
    .join("\n");

  return `# Look Brief: ${film.title} (\`${film.id}\`)

Every explainer video gets a written look plan before any visual assets or animation clips are created.
Write \`videos/${film.id}/design/look.json\` and run \`aideos look check ${film.id}\` until it reports PASS.

## The 6 Look Questions to Answer

1. **What is the stage?**
   One sentence naming the world the whole film lives in. Every new explainer is a scene film on one persistent 2D spatial canvas. Never clear or jump between disconnected stages.
2. **What carries over?**
   A cast list of named objects. For each: what it is, when it enters, and how it transforms across beats.
   *Important*: describe each change as a distinct resulting state. It must be large enough to recognize (magnitude "moderate" or "major"), finish while the camera holds on that object, and remain visible for at least about 2 seconds. Minor or imperceptible changes break continuity.
3. **The camera.**
   Must start wide (establishing view) and end wide (payoff view). Use move-then-hold: make each move a short, deliberate turn toward the object the narration is about to discuss, arrive about one beat before its cue word, then hold that subject for about 3 to 5 seconds. Name the focused cast object on each close pose. Do not let the camera drift continuously between subjects. Keep moves under 20% of frame width per second.
4. **The palette.**
   Background (e.g. \`#0A0A0B\`), ink/text, and the film's one primary accent (e.g. \`#635BFF\`). Use only the locked palette and this accent; do not declare extra colours.
5. **Captions.**
   Burned-in at the bottom band (\`position: "bottom"\`, \`kineticColumn: false\`). Never use kinetic text columns over the artwork.
6. **Headlines.**
   Headline cards over the stage (\`"none"\`, \`"few"\`, or \`"all"\`). Prefer \`"none"\` so the stage carries the story.

## Shot Treatment Decision Rules

For each shot, pick exactly one treatment:
- **\`scene\`** (Default): the stage moves; a carried object demonstrates what the narration says.
- **\`scene+card\`**: the stage stays visible with slow motion; a short text card sits over it.
- **\`device\`**: an inset template device (StatCounter, Plot, TokenStrip, MatrixGrid, CodeBlock) shown over the stage while the stage remains visible. Rules:
  - Allowed only for exact numbers, token streams, or code.
  - No two \`device\` shots in a row.
  - Limit: at most 1 \`device\` shot per 4 shots.
- **\`footage\`**: RESERVED. The checker will reject this.

## Cast ID Rule

Each \`film.cast[].id\` must be a lowercase id using letters, digits, and hyphens. In the design, every cast id must match a \`design.json\` asset id or an SVG element id. Multiple assets may use elements with the same cast id when one planned object is drawn across several SVG files.

## Look Plan Schema (look.json)

\`\`\`json
${JSON.stringify(EXAMPLE_LOOK_PLAN, null, 2)}
\`\`\`

## Script Beats

${shotList}

## Commands

- Check the look plan: \`aideos look check ${film.id}\`
- Render the human-readable plan: \`aideos look check ${film.id}\` automatically generates \`design/LOOK.md\` on PASS.
`;
}

// Writes design/LOOK_BRIEF.md for a film package and returns the written file path.
export function writeLookBrief(filmId: string): string {
  const pkgDir = resolvePackageDir(filmId);
  const filmFile = path.join(pkgDir, "film.json");
  if (!fs.existsSync(filmFile)) {
    throw new Error(`cannot write LOOK_BRIEF.md: film.json not found in package ${filmId} (${pkgDir})`);
  }
  const film = parseFilm(JSON.parse(fs.readFileSync(filmFile, "utf8")));
  const dir = path.join(pkgDir, "design");
  fs.mkdirSync(dir, { recursive: true });
  const briefFile = path.join(dir, "LOOK_BRIEF.md");
  fs.writeFileSync(briefFile, renderLookBrief(film), "utf8");
  return briefFile;
}
