import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const FILMS_DIR = path.join(ROOT, "src/dl/films");
const VIDEOS_DIR = path.join(ROOT, "videos");

if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

async function migrate() {
  const filmFiles = fs.readdirSync(FILMS_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  console.log(`Found ${filmFiles.length} films to package into videos/...`);

  for (const file of filmFiles) {
    const slug = file.replace(/\.ts$/, "");
    const modulePath = path.join(FILMS_DIR, file);

    try {
      const imported = await import(modulePath);
      const film = Object.values(imported).find((v: any) => v && typeof v === "object" && (v.schemaVersion || v.shots || v.canvas)) as any;

      if (!film) {
        console.warn(`Skipping ${file}: no Film export found.`);
        continue;
      }

      const pkgDir = path.join(VIDEOS_DIR, slug);
      const visualsDir = path.join(pkgDir, "visuals");
      fs.mkdirSync(visualsDir, { recursive: true });

      // 1. Write film.json
      fs.writeFileSync(path.join(pkgDir, "film.json"), JSON.stringify(film, null, 2), "utf8");

      // 2. Write shotlist.json
      const shotlist = {
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
      };
      fs.writeFileSync(path.join(pkgDir, "shotlist.json"), JSON.stringify(shotlist, null, 2), "utf8");

      // 3. Write treatment.json
      const treatment = {
        id: film.id || slug,
        title: film.title,
        chapters: film.chapters || [],
        theme: film.theme || {},
        accent: film.accent || "#635BFF",
      };
      fs.writeFileSync(path.join(pkgDir, "treatment.json"), JSON.stringify(treatment, null, 2), "utf8");

      // 4. Write visuals/index.ts
      const visualsIndexContent = `/**
 * Bespoke SVG components and custom graphics for "${film.title}".
 */
export const visuals = {};
`;
      if (!fs.existsSync(path.join(visualsDir, "index.ts"))) {
        fs.writeFileSync(path.join(visualsDir, "index.ts"), visualsIndexContent, "utf8");
      }

      console.log(`✓ Packaged videos/${slug}/ (film.json, shotlist.json, treatment.json, visuals/)`);
    } catch (err) {
      console.error(`Error importing ${file}:`, err);
    }
  }

  console.log("\nAll video packages successfully generated in videos/!");
}

migrate().catch(console.error);
