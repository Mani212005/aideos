/**
 * File Description: Writes LOOK_BRIEF.md for an Aideos film, instructing the agent or designer on the 6 look questions, the criteria for shot treatments, character films (performances, the characters available and how to author a new one), and the measured script beats.
 * Inputs and outputs: Film ID and package data (film.json, package and library characters) -> LOOK_BRIEF.md markdown file in package design folder.
 * Used by: backend/cli.ts, backend/designSpec/designer.ts, backend/mcp/designTools.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFilm, type Film } from "../../src/dl/schema";
import { resolvePackageDir, resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import { CHARACTER_LIBRARY, loadCharacterFile } from "../characters/library";

/** A character an author can name in a performance, as the brief lists it. */
export interface AvailableCharacter {
  id: string;
  version: number;
  hash: string;
  name: string;
  description: string;
  /** "package" for videos/<slug>/characters, "library" for the committed characters/ folder. */
  source: "package" | "library";
}

// Lists every character a film can resolve (package first, so a package spec hides a library spec of the same id), skipping specs that fail their checks.
export function availableCharacters(pkgDir?: string): AvailableCharacter[] {
  const found = new Map<string, AvailableCharacter>();
  const dirs: Array<[string, AvailableCharacter["source"]]> = [...(pkgDir ? [[path.join(pkgDir, "characters"), "package"] as [string, AvailableCharacter["source"]]] : []), [resolveRepoAssetPath(CHARACTER_LIBRARY), "library"]];
  for (const [dir, source] of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".character.json")).sort()) {
      const loaded = loadCharacterFile(path.join(dir, file));
      const spec = loaded.spec;
      if (!spec?.hash || loaded.errors.length || found.has(spec.id) || file !== `${spec.id}.character.json`) continue;
      found.set(spec.id, { id: spec.id, version: spec.version, hash: spec.hash, name: spec.name, description: spec.description ?? "", source });
    }
  }
  return [...found.values()];
}

// Builds a worked aideos.look/2 plan for a receive performance, pinned to a real character's identity.
export function exampleStageLookPlan(character: Pick<AvailableCharacter, "id" | "version" | "hash">) {
  const shot = (id: string, cue: string) => ({ id, treatment: "scene", carries: ["receiver", "glider"], performances: ["receive-message"], cue, criterion: "1-mechanism", why: "the catch is the claim" });
  return {
    schema: "aideos.look/2",
    decidedBy: { agent: "claude", model: "claude-sonnet-5-5", at: "2026-10-11T12:00:00Z" },
    film: {
      mode: "scene",
      renderer: "three",
      stage: "One persistent stage where a courier receives a paper glider standing in for a message.",
      cast: [
        { id: "receiver", renderer: "three", treatment: "cel-v1", character: character.id, what: "the receiver", enters: "beat-01", changes: [{ at: "beat-02", how: "reaches, catches the glider and settles holding it", state: "holding the message", magnitude: "major" }] },
        { id: "glider", renderer: "three", asset: "paper-glider-v1", treatment: "cel-v1", what: "paper glider, an illustrative message", enters: "beat-01", changes: [{ at: "beat-02", how: "stops flying and stays in the receiver's hand", state: "holding the message", magnitude: "major" }] },
      ],
      performances: [{
        id: "receive-message", action: "receive-v1", actor: "receiver", character: { id: character.id, version: character.version, hash: character.hash }, prop: "glider",
        start: "beat-01", decisive: { shotId: "beat-02", phrase: "catches", edge: "start", event: "contact" }, afterState: "holding the message", carries: ["beat-01", "beat-02", "beat-03"],
      }],
      camera: [{ at: "beat-01", pose: "wide establishing view of the stage", why: "show where the message comes from" }, { at: "beat-03", pose: "wide payoff with the held glider", why: "the receipt is the payoff" }],
      palette: { bg: "#0A0A0B", accent: "#635BFF" },
      captions: { position: "bottom", kineticColumn: false },
      headlines: "none",
    },
    shots: [shot("beat-01", "travels"), shot("beat-02", "catches"), shot("beat-03", "acknowledgment")],
  };
}

// Renders the character-film section: what a performance is, which characters exist and how to make a new one.
export function renderCharacterSection(characters: AvailableCharacter[]): string {
  const rows = characters.length
    ? characters.map((c) => `| \`${c.id}\` | ${c.version} | \`${c.hash}\` | ${c.source} | ${c.name}: ${c.description.split(/(?<=\.)\s/)[0] ?? ""} |`).join("\n")
    : "| (none found) | | | | |";
  const example = characters[0] ? `\n\`\`\`json\n${JSON.stringify(exampleStageLookPlan(characters[0]), null, 2)}\n\`\`\`\n` : "";
  return `## Character films (\`aideos.look/2\`, renderer \`three\`)

Use this when a character acts out the mechanism on a persistent cel-shaded stage. Everything else in this brief still applies.

- **Cast.** The character and its prop are cast items with \`renderer: "three"\` and \`treatment: "cel-v1"\`. The character item names its spec with \`character: "<id>"\`; the prop is \`asset: "paper-glider-v1"\`.
- **Performance.** \`film.performances[]\` says, in data, who does what on which word: \`id\`, \`action\` (\`receive-v1\`: the character catches the glider), \`actor\` (the cast id), \`character\` (\`{id, version, hash}\` copied from the table below), \`prop\`, \`start\` (the cue where anticipation begins), \`decisive\` (\`{shotId, phrase, edge, event: "contact"}\`: the spoken word the catch lands on), \`afterState\` (what is true afterwards) and \`carries\` (the shots that keep the actor and prop on stage).
- **Timing.** The hand meets the glider exactly on the decisive word. Anticipation starts earlier (at \`start\`, before the word) and recovery settles after it, so a performance shot does not need a clip starting on its cue; the review measures the contact frame against the spoken word instead.
- **Shots.** Every shot that shows the performance lists its id in \`shots[].performances\`; the decisive shot must. \`design/design.json\` repeats each performance once with the same id, action, actor, prop, start, decisive cue and after-state.
- **What is checked.** The look check resolves each character (package, then library), refuses a different \`version\`, warns when the art \`hash\` changed since the plan (design and render then rebuild with the new art), and checks the decisive phrase is spoken in its shot and starts after \`start\`. Projected geometry is checked at design build. Face appeal, finger contact and final on-screen occlusion are not measured by any tool: look at the character sheet and the rendered stills.

### Characters this film can use

| id | version | hash | from | who |
|---|---|---|---|---|
${rows}

### A new character, before the film

1. Copy the closest spec into \`videos/<slug>/characters/<id>.character.json\` and edit it (guide: \`characters/README.md\`).
2. \`aideos character check <file> --stamp\` until it reports PASS; it prints the version and hash to put in the performance.
3. \`aideos character sheet <file>\` and look at every image (model sheet, expressions, the receive in wide and reel) before planning a film around it.
${example}`;
}

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

// Renders the LOOK_BRIEF.md markdown for a film, including the characters it can name.
export function renderLookBrief(film: Film, characters: AvailableCharacter[] = availableCharacters()): string {
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

${renderCharacterSection(characters)}
## Script Beats

${shotList}

## Commands

- Check the look plan: \`aideos look check ${film.id}\`
- Render the human-readable plan: \`aideos look check ${film.id}\` automatically generates \`design/LOOK.md\` on PASS.
- Check or draw a character: \`aideos character check <id-or-file>\`, \`aideos character sheet <id-or-file>\`.
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
  fs.writeFileSync(briefFile, renderLookBrief(film, availableCharacters(pkgDir)), "utf8");
  return briefFile;
}
