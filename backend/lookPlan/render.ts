/**
 * File Description: Renders human-readable LOOK.md documentation from a machine-checked look.json LookPlan, including character performances in plain words.
 * Inputs and outputs: LookPlan object, optional Film metadata and character names -> Markdown string formatted as LOOK.md.
 * Used by: backend/cli.ts, backend/pipeline/run.ts, backend/mcp/designTools.ts; Gemini review reads its shot section.
 */

import fs from "node:fs";
import path from "node:path";
import { type LookPerformance, type LookPlan, parseLookPlan } from "./schema";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { availableCharacters } from "./brief";

// Says one performance in plain words: who, which character, what, on which spoken word, and what stays true after.
export function describePerformance(p: LookPerformance, names: Record<string, string> = {}): string {
  const who = names[p.character.id] ? `${names[p.character.id]} (character \`${p.character.id}\` v${p.character.version}, hash \`${p.character.hash.slice(0, 12)}\`)` : `character \`${p.character.id}\` v${p.character.version} (hash \`${p.character.hash.slice(0, 12)}\`)`;
  const start = typeof p.start === "number" ? `frame ${p.start}` : `\`${p.start}\``;
  return `**${p.id}** (${p.action}): ${who} plays cast \`${p.actor}\` and catches \`${p.prop}\`. Anticipation starts at ${start}; the hand meets the ${p.prop} on "${p.decisive.phrase}" (${p.decisive.edge} of the word) in shot \`${p.decisive.shotId}\`, then recoils and settles. Afterwards: ${p.afterState}. Kept on stage in ${p.carries.map((id) => `\`${id}\``).join(", ")}.`;
}

// Renders the stage section of a v2 plan: the renderer, each performance and what no tool measures.
function stageSection(plan: Extract<LookPlan, { schema: "aideos.look/2" }>, names: Record<string, string>): string {
  return `Renderer: three (orthographic persistent stage, cel-v1). ${plan.film.performances.length} performance(s) by ${new Set(plan.film.performances.map((p) => p.character.id)).size} character(s).

${plan.film.performances.map((p) => `- ${describePerformance(p, names)}`).join("\n")}

Look check completed: schema, shot and cast ids, cast and character resolution, decisive phrases spoken once in their shots, and performance starts before decisive words. Pending at design build: verify contact lands on the decisive word and projected geometry clears the wide and reel crops, caption band and inset. Not measured by any tool: face appeal, finger contact and final on-screen occlusion; judge those by eye with \`aideos character sheet\` and the rendered stills. Art references: src/dl/scene/rigs/NOTICE.md.`;
}

// Formats seconds into m:ss clock format.
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Renders markdown for a look plan.
export function renderLookMd(plan: LookPlan, filmTitle?: string, shotTimings?: { id: string; start: number; end: number; dur: number }[], characterNames: Record<string, string> = {}): string {
  const title = filmTitle || "Film Look Plan";

  // Build shot map for timings if provided
  const timingMap = new Map<string, { start: number; end: number; dur: number }>();
  if (shotTimings) {
    for (const st of shotTimings) {
      timingMap.set(st.id, st);
    }
  }

  const castTableRows = plan.film.cast
    .map((c) => {
      const changesText = c.changes.length > 0
        ? c.changes.map((ch) => `${ch.at}: ${ch.how}${ch.state ? ` -> ${ch.state}` : ""}${ch.magnitude ? ` (${ch.magnitude})` : ""}`).join("; ")
        : "None";
      return `| \`${c.id}\` | ${c.what} | ${c.enters} | ${changesText} |`;
    })
    .join("\n");

  const cameraRows = plan.film.camera
    .map((cam) => `- **${cam.at}**: ${cam.pose}${cam.focus ? ` [focus: ${cam.focus}]` : ""} (${cam.why})`)
    .join("\n");

  const shotLines = plan.shots.map((s, idx) => {
    const timing = timingMap.get(s.id);
    let timeStr = "";
    if (timing) {
      timeStr = `${clock(timing.start)}-${clock(timing.end)} `;
    } else {
      timeStr = `shot-${idx + 1} `;
    }
    const carriesStr = s.carries.length > 0 ? ` [carries: ${s.carries.join(", ")}]` : "";
    const deviceStr = s.device ? ` (${s.device})` : "";
    const performances = plan.schema === "aideos.look/2" ? plan.film.performances.filter((p) => "performances" in s && s.performances.includes(p.id)) : [];
    const performsStr = performances.length ? ` [performs: ${performances.map((p) => p.decisive.shotId === s.id ? `${p.id}, contact on "${p.decisive.phrase}"` : p.id).join("; ")}]` : "";
    return `- ${timeStr}\`${s.id}\` **${s.treatment}**${deviceStr}${carriesStr}${performsStr}: on "${s.cue}" (${s.why})`;
  }).join("\n");

  return `# Look Plan: ${title}

**Decided by**: ${plan.decidedBy.agent} (${plan.decidedBy.model}) at ${plan.decidedBy.at}${plan.decidedBy.how ? ` - ${plan.decidedBy.how}` : ""}

## Stage

${plan.film.stage}

${plan.schema === "aideos.look/2" ? stageSection(plan, characterNames) : ""}

## Cast (Persistent Elements)

| ID | What | Enters | Changes Across Beats |
|---|---|---|---|
${castTableRows}

## Camera

${cameraRows}

## Palette & Style

- **Background**: \`${plan.film.palette.bg}\`
- **Accent**: \`${plan.film.palette.accent}\`
- **Captions**: Position ${plan.film.captions.position} (kinetic column: ${plan.film.captions.kineticColumn ? "yes" : "no"})
- **Headlines**: ${plan.film.headlines}

## Shots & Beat Treatments

${shotLines}
`;
}

// Renders and writes LOOK.md in videos/<slug>/design/LOOK.md from look.json.
export function writeLookMd(filmId: string): string {
  const pkgDir = resolvePackageDir(filmId);
  const lookFile = path.join(pkgDir, "design", "look.json");
  if (!fs.existsSync(lookFile)) {
    throw new Error(`cannot render LOOK.md: no look.json found at ${lookFile}`);
  }
  const rawLook = JSON.parse(fs.readFileSync(lookFile, "utf8"));
  const look = parseLookPlan(rawLook);

  // Read film.json if present for titles and timing
  let title = filmId;
  let timings: { id: string; start: number; end: number; dur: number }[] | undefined;
  const filmFile = path.join(pkgDir, "film.json");
  if (fs.existsSync(filmFile)) {
    try {
      const film = JSON.parse(fs.readFileSync(filmFile, "utf8"));
      if (film.title) title = film.title;
      if (Array.isArray(film.shots)) {
        let t = 0;
        timings = film.shots.map((s: { id: string; dur?: number }) => {
          const dur = typeof s.dur === "number" ? s.dur : 5;
          const res = { id: s.id, start: t, end: t + dur, dur };
          t += dur;
          return res;
        });
      }
    } catch {
      // Ignore errors reading film.json
    }
  }

  const names = Object.fromEntries(availableCharacters(pkgDir).map((c) => [c.id, c.name]));
  const content = renderLookMd(look, title, timings, names);
  const outFile = path.join(pkgDir, "design", "LOOK.md");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content, "utf8");
  return outFile;
}
