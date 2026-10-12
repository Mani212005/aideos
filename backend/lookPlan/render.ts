/**
 * File Description: Renders human-readable LOOK.md documentation from a machine-checked look.json LookPlan.
 * Inputs and outputs: LookPlan object and optional Film metadata -> Markdown string formatted as LOOK.md.
 * Used by: backend/lookPlan/render.ts, backend/cli.ts, backend/lookPlan/brief.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { type LookPlan, parseLookPlan } from "./schema";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";

// Formats seconds into m:ss clock format.
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Renders markdown for a look plan.
export function renderLookMd(plan: LookPlan, filmTitle?: string, shotTimings?: { id: string; start: number; end: number; dur: number }[]): string {
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

  const extraPalette = Object.entries(plan.film.palette.extra || {})
    .map(([col, note]) => `\`${col}\`: ${note}`)
    .join(", ");

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
    return `- ${timeStr}\`${s.id}\` **${s.treatment}**${deviceStr}${carriesStr}: on "${s.cue}" (${s.why})`;
  }).join("\n");

  return `# Look Plan: ${title}

**Decided by**: ${plan.decidedBy.agent} (${plan.decidedBy.model}) at ${plan.decidedBy.at}${plan.decidedBy.how ? ` - ${plan.decidedBy.how}` : ""}

## Stage

${plan.film.stage}

## Cast (Persistent Elements)

| ID | What | Enters | Changes Across Beats |
|---|---|---|---|
${castTableRows}

## Camera

${cameraRows}

## Palette & Style

- **Background**: \`${plan.film.palette.bg}\`
- **Accent**: \`${plan.film.palette.accent}\`
${extraPalette ? `- **Extra Colours**: ${extraPalette}\n` : ""}- **Captions**: Position ${plan.film.captions.position} (kinetic column: ${plan.film.captions.kineticColumn ? "yes" : "no"})
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

  const content = renderLookMd(look, title, timings);
  const outFile = path.join(pkgDir, "design", "LOOK.md");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content, "utf8");
  return outFile;
}
