/**
 * File Description: Migration script to compile films into per-video package directories.
 * Converts films in src/dl/films/ into standalone video packages under videos/<slug>/.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = typeof __dirname !== "undefined" ? path.resolve(__dirname, "..") : process.cwd();
const FILMS_DIR = path.join(ROOT, "src/dl/films");
const VIDEOS_DIR = path.join(ROOT, "videos");

if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

/**
 * Normalizes text to eliminate long dashes per repository standards.
 */
function sanitizeDashes(text: string): string {
  return text.replace(/\u2014/g, " - ").replace(/\u2013/g, " - ").replace(/\s+-\s+/g, " - ");
}

/**
 * Recursively removes long dashes from object string fields.
 */
function sanitizeObject(obj: any): any {
  if (typeof obj === "string") {
    return sanitizeDashes(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  if (obj && typeof obj === "object") {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = sanitizeObject(obj[key]);
    }
    return res;
  }
  return obj;
}

/**
 * Migrates all film definitions into structured video packages.
 */
async function migrate() {
  const filmFiles = fs.readdirSync(FILMS_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  console.log(`Found ${filmFiles.length} films to package into videos/...`);

  for (const file of filmFiles) {
    const slug = file.replace(/\.ts$/, "");
    const modulePath = path.join(FILMS_DIR, file);

    try {
      const imported = await import(modulePath);
      const rawFilm = Object.values(imported).find((v: any) => v && typeof v === "object" && (v.schemaVersion || v.shots || v.canvas)) as any;

      if (!rawFilm) {
        console.warn(`Skipping ${file}: no Film export found.`);
        continue;
      }

      const film = sanitizeObject(rawFilm);
      const pkgDir = path.join(VIDEOS_DIR, slug);
      const visualsDir = path.join(pkgDir, "visuals");
      fs.mkdirSync(visualsDir, { recursive: true });

      // 1. Write film.json
      fs.writeFileSync(path.join(pkgDir, "film.json"), JSON.stringify(film, null, 2), "utf8");

      // 2. Write shotlist.json
      const shotlist = sanitizeObject({
        filmId: film.id || slug,
        title: film.title,
        shots: (film.shots || []).map((s: any) => ({
          id: s.id,
          duration: s.dur,
          chapter: s.ch,
          stage: s.stage,
          look: s.look,
          move: s.move,
          scriptText: s.scriptText,
          visualDirection: s.visualDirection,
          metaphor: s.metaphor,
          blocks: s.blocks,
        })),
      });
      fs.writeFileSync(path.join(pkgDir, "shotlist.json"), JSON.stringify(shotlist, null, 2), "utf8");

      // 3. Write treatment.json
      const treatment = sanitizeObject({
        id: film.id || slug,
        title: film.title,
        chapters: film.chapters || [],
        theme: film.theme || {},
        accent: film.accent || "#635BFF",
      });
      fs.writeFileSync(path.join(pkgDir, "treatment.json"), JSON.stringify(treatment, null, 2), "utf8");

      // 4. Write visuals/index.ts
      const cleanTitle = sanitizeDashes(film.title || slug);
      const visualsIndexContent = `/**
 * File Description: Bespoke visual graphics and SVG components for ${cleanTitle}.
 */

export const visuals = {};
`;
      fs.writeFileSync(path.join(visualsDir, "index.ts"), visualsIndexContent, "utf8");

      console.log(`✓ Packaged videos/${slug}/ (film.json, shotlist.json, treatment.json, visuals/)`);
    } catch (err) {
      console.error(`Error importing ${file}:`, err);
    }
  }

  console.log("\nAll video packages successfully generated in videos/!");
}

migrate().catch(console.error);
