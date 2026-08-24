import { Command, Option } from "commander";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import { z } from "zod";
import { DEVICE_BLOCKS, filmBaseSchema, parseFilm } from "../src/dl/schema";
import type { Film } from "../src/dl/schema";
import { processAudioForFilm } from "./audio";
import { createEngine } from "./engine";
import { parsePrompts, parseTreatment, parseShotlist } from "./ideation/schemas";
import { runIdeate, runShoot, runPrompts } from "./ideation/stages";
import { compileFilm, extractJobSpecs } from "./ideation/compile";
import type { Treatment } from "./ideation/schemas";

dotenv.config({ quiet: true });

/** Resolved from the module, not the shell, so the CLI works from any cwd. */
const ROOT = path.resolve(__dirname, "..");
const GENERATED_PATH = path.join(ROOT, "src/dl/films/generated.ts");
const ACTIVE_FILM_PATH = path.join(ROOT, "src/dl/activeFilm.ts");

const program = new Command();
program
  .name("aideos-backend")
  .description("Generate and render Aideos films from natural language")
  .version("1.0.0");

/**
 * The tool schema *is* the film schema. Hand-writing a JSON Schema alongside
 * `filmSchema` means every constraint the validator enforces — id patterns,
 * `dur` bounds, unit-space points, the block union — has to be remembered
 * twice, and the copy silently rots. Deriving it means the model is told about
 * a new field the moment the schema grows one.
 *
 * `io: "input"` so defaulted fields stay optional: the model omitting `zoom`
 * is correct, not a mistake. The pacing rules in `superRefine` cannot be
 * expressed in JSON Schema, so they live in the system prompt below and are
 * enforced for real by `parseFilm` before anything is written to disk.
 */
const filmParameters = z.toJSONSchema(filmBaseSchema, {
  io: "input",
  target: "draft-7",
  unrepresentable: "any",
  reused: "inline",
}) as Record<string, unknown>;

const systemPrompt = `You are an expert at generating Aideos Film configurations. Create a visually engaging explainer video.

Structure:
- Provide realistic 2D coordinates for nodes (e.g. x: 0..2000, y: 0..1000). Lay the graph out left to right so every edge points forward.
- Every node id named by an edge or by a shot's "look" must exist in canvas.nodes. Node and shot ids are lowercase letters, digits and dashes only.
- The first shot must use move: "cut" — it has nothing to move from.
- A shot with move: "cut" opens the next chapter, and the chapter rail reads its label from the chapters array. So the number of shots with move: "cut" must equal chapters.length, and each cut must land where that chapter's section of the argument begins.
- Do not provide 'audio', 'voiceover', or 'captions' fields, nor 'src' for AnalogyInset, as these require specific existing files in the public directory.
- stage: "none" carries no blocks.
- For each shot, provide 'scriptText' containing the narration/script the AI voice should speak during that shot. Keep it conversational.

Pacing (all enforced; a violation fails validation):
- Device blocks are: ${DEVICE_BLOCKS.join(", ")}.
- No shot holding a device may run past 25s, and no device may follow itself — put the canvas or another device between them.
- A text beat (stage: "frame") at least every 60-90s.
- A return to the bare canvas (stage: "none") at least every 60-90s.
- stage: "anchor" and stage: "frame" must carry at least one block.
- stage: "anchor" cannot look at "all" — name the single node the panel grows out of.
- At most 3 accents in one shot. Each device block, each StatCounter, each Card with state "active", each TextReveal with an accentWord and each Math whose text contains *stars* spends one.
- Each shot's dur is 2..45 seconds, and the film totals at least 10s.`;

const FORMATS = {
  long: { script: "render", label: "long (1920×1080) → out/long.mp4" },
  reel: { script: "render:reel", label: "reel (1080×1920) → out/reel.mp4" },
} as const;

/** Lowercase-dash slug for file and film ids. */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "film"
  );
}

/** Production dir for a topic; everything a stage emits lives there. */
function productionDir(topic: string): string {
  return path.join(ROOT, "production", topic);
}

/** Read and parse one staged artifact from disk. */
async function readArtifact<T>(file: string, parse: (raw: unknown) => T, label: string): Promise<T> {
  const raw = await fs.readFile(file, "utf-8").catch(() => {
    throw new Error(`${label} not found at ${file}; run the earlier stage first.`);
  });
  try {
    return parse(JSON.parse(raw));
  } catch (err) {
    throw new Error(`${label} at ${file} is invalid: ${(err as Error).message}`);
  }
}

/** Keeps the hand-written explanation that makes this file readable. */
const activeFilmModule = () =>
  `import { generatedFilm } from "./films/generated";
import type { Film } from "./schema";

/**
 * Which film renders. One line, so swapping the subject of the whole pipeline
 * is a one-word change rather than a search through the components.
 */
export const ACTIVE_FILM: Film = generatedFilm;
`;

/**
 * Written from the *parsed* film, so the defaults the schema applies are on the
 * page. The raw tool arguments omit them, and a module annotated `Film` that
 * leaves out `w`, `dashed` or `stage` typechecks only by accident.
 */
const generatedModule = (film: Film) =>
  `import type { Film } from "../schema";

/**
 * Generated by \`npm run backend generate\`. Regenerating overwrites it.
 *
 * Pure data — the only import is a type, so the validator can load this in
 * plain Node with no React, no fonts and no browser.
 */
export const generatedFilm: Film = ${JSON.stringify(film, null, 2)};
`;

program
  .command("generate")
  .description("Generate an Aideos film from a prompt")
  .argument("<prompt>", "Natural language description of the video")
  .addOption(
    new Option("--format <format>", "which composition to render")
      .choices(["long", "reel", "both"])
      .default("long"),
  )
  .action(async (prompt: string, options: { format: "long" | "reel" | "both" }) => {
    // Constructed here rather than at module scope so `--help` and `--version`
    // still work without a key, and so a missing one is one line, not a stack.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set. Put it in .env or the environment.");
    const openai = new OpenAI({ apiKey });

    console.log(`Generating film for prompt: "${prompt}"...`);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      // A film is a large payload; the default ceiling truncates the tool call
      // into unparseable JSON, which reads as a mystery syntax error.
      max_completion_tokens: 16384,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "generate_aideos_film",
            description:
              "Generates an Aideos Film JSON structure representing canvas nodes, shots, and blocks.",
            parameters: filmParameters,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "generate_aideos_film" } },
    });

    const choice = completion.choices[0];
    if (!choice) throw new Error("The model returned no choices.");
    if (choice.finish_reason === "length")
      throw new Error("The model's tool call was cut off mid-JSON. Ask for a shorter film.");

    const toolCall = choice.message.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function")
      throw new Error("The model returned no film tool call.");

    let raw: unknown;
    try {
      raw = JSON.parse(toolCall.function.arguments);
    } catch (err) {
      throw new Error(`The model's tool call was not valid JSON: ${(err as Error).message}`);
    }

    // Validate before touching the tree. `npm run validate` catches the same
    // errors, but only after `activeFilm.ts` has been repointed at the broken
    // film — and then studio, frames and render all fail until it is reverted.
    let film = parseFilm(raw);

    const publicDir = path.join(ROOT, "public");
    if (process.env.DEEPGRAM_API_KEY) {
      console.log("Deepgram key found, generating TTS and STT...");
      try {
        film = await processAudioForFilm(film, publicDir);
      } catch (err) {
        console.error("Audio generation failed, continuing without audio:", err);
      }
    } else {
      console.log("No DEEPGRAM_API_KEY found, skipping audio generation.");
    }

    await fs.writeFile(GENERATED_PATH, generatedModule(film), "utf-8");
    console.log(`Saved generated film to ${GENERATED_PATH}`);

    const previousActive = await fs.readFile(ACTIVE_FILM_PATH, "utf-8").catch(() => null);
    await fs.writeFile(ACTIVE_FILM_PATH, activeFilmModule(), "utf-8");
    console.log(`Updated activeFilm.ts to use generatedFilm.`);

    console.log(`Validating...`);
    try {
      execSync("npm run validate", { stdio: "inherit", cwd: ROOT });
      console.log(`Validation successful.`);
    } catch {
      if (previousActive !== null) {
        await fs.writeFile(ACTIVE_FILM_PATH, previousActive, "utf-8");
        console.error("Restored the previous activeFilm.ts; the generated film is still on disk.");
      }
      throw new Error("Validation failed.");
    }

    const formats =
      options.format === "both" ? (["long", "reel"] as const) : ([options.format] as const);
    for (const key of formats) {
      console.log(`Rendering ${FORMATS[key].label}...`);
      try {
        execSync(`npm run ${FORMATS[key].script}`, { stdio: "inherit", cwd: ROOT });
      } catch {
        throw new Error(`Render failed for the ${key} format.`);
      }
    }
    console.log(`Render complete.`);
  });

program
  .command("ideate")
  .description("Stage 1: idea -> treatment.json (story arc, chapters, style block)")
  .argument("<idea>", "The video idea or script seed")
  .option("--dir <dir>", "production directory name")
  .action(async (idea: string, options: { dir?: string }) => {
    const treatment = await runIdeate(idea);
    const dir = productionDir(options.dir ?? slugify(treatment.title));
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, "treatment.json");
    await fs.writeFile(out, JSON.stringify(treatment, null, 2));
    console.log(`Treatment saved to ${out}`);
    console.log(`Next: npm run backend -- shoot ${path.relative(ROOT, out)}`);
  });

program
  .command("shoot")
  .description(
    "Stage 2: treatment -> shotlist.json (paced shot list, gated by parseFilm rules before write)",
  )
  .argument("<treatment>", "Path to treatment.json")
  .action(async (treatmentPath: string) => {
    const resolved = path.resolve(ROOT, treatmentPath);
    const treatment = await readArtifact(resolved, parseTreatment, "treatment");
    console.log(`Shooting "${treatment.title}" (${treatment.chapters.length} chapters)...`);
    const shotlist = await runShoot(treatment);
    // Emit beside the treatment so the whole stage chain stays one directory.
    const dir = productionDir(path.basename(path.dirname(resolved)));
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, "shotlist.json");
    await fs.writeFile(out, JSON.stringify(shotlist, null, 2));
    const flagged = shotlist.shots.filter((s) => s.needsFootage).length;
    console.log(
      `Shot list passed the pacing gate: ${shotlist.shots.length} shots, ${flagged} flagged for footage. Saved to ${out}`,
    );
    console.log(`Next: npm run backend -- prompts ${path.relative(ROOT, out)}`);
  });

program
  .command("prompts")
  .description("Stage 3: shotlist -> prompts.json (self-contained b-roll prompts per needsFootage shot)")
  .argument("<shotlist>", "Path to shotlist.json")
  .action(async (shotlistPath: string) => {
    const resolved = path.resolve(ROOT, shotlistPath);
    const shotlist = await readArtifact(resolved, parseShotlist, "shotlist");
    const dir = path.dirname(resolved);
    const treatment = await readArtifact(
      path.join(dir, "treatment.json"),
      parseTreatment,
      "treatment",
    );
    const flagged = shotlist.shots.filter((s) => s.needsFootage);
    if (flagged.length === 0) {
      console.log("No shots flagged needsFootage; nothing to prompt.");
      return;
    }
    const file = await runPrompts(shotlist, treatment);
    const out = path.join(dir, "prompts.json");
    await fs.writeFile(out, JSON.stringify(file, null, 2));
    console.log(`${file.prompts.length} b-roll prompt(s) saved to ${out}`);
    console.log(`Next: npm run backend -- assemble ${path.relative(ROOT, dir)}`);
  });

program
  .command("assemble")
  .description(
    "Stage 4 handoff: compile treatment + shotlist + prompts into film.json and render b-roll through a VideoEngine",
  )
  .argument("<dir>", "Production directory holding treatment.json / shotlist.json / prompts.json")
  .option("--engine <name>", "which engine renders the b-roll", "null")
  .option("--skip-footage", "compile film.json only, do not submit b-roll jobs")
  .option("--only <shotId>", "render b-roll for one shot id only")
  .option("--install", "also install the film as activeFilm and run npm run validate")
  .action(
    async (
      dirArg: string,
      options: { engine: string; skipFootage?: boolean; only?: string; install?: boolean },
    ) => {
      const dir = path.resolve(ROOT, dirArg);
      const treatment: Treatment = await readArtifact(
        path.join(dir, "treatment.json"),
        parseTreatment,
        "treatment",
      );
      const shotlist = await readArtifact(
        path.join(dir, "shotlist.json"),
        parseShotlist,
        "shotlist",
      );
      const prompts = await readArtifact(
        path.join(dir, "prompts.json"),
        parsePrompts,
        "prompts",
      ).catch(() => null);

      const film = compileFilm(treatment, shotlist);
      const filmOut = path.join(dir, "film.json");
      await fs.writeFile(filmOut, JSON.stringify(film, null, 2));
      console.log(`Film compiled and re-validated against parseFilm: ${filmOut}`);

      if (options.install) {
        await fs.writeFile(GENERATED_PATH, generatedModule(film), "utf-8");
        await fs.writeFile(ACTIVE_FILM_PATH, activeFilmModule(), "utf-8");
        console.log(`Installed as activeFilm; validating...`);
        execSync("npm run validate", { stdio: "inherit", cwd: ROOT });
        console.log(`Validation successful.`);
      }

      if (options.skipFootage) return;

      const allJobs = extractJobSpecs(treatment, shotlist, prompts);
      const jobs = options.only ? allJobs.filter((j) => j.shotId === options.only) : allJobs;
      if (options.only && jobs.length === 0)
        throw new Error(`no needsFootage shot named "${options.only}"; flagged shots: ${allJobs.map((j) => j.shotId).join(", ") || "none"}`);
      if (jobs.length === 0) {
        console.log("No needsFootage shots; no b-roll jobs to submit.");
        return;
      }
      const engine = createEngine(options.engine);
      const footageDir = path.join(dir, "footage");
      for (const { shotId, spec } of jobs) {
        console.log(`[${engine.name}] submitting b-roll for shot "${shotId}": "${spec.prompt.slice(0, 80)}..."`);
        const handle = await engine.submit(spec);
        for (;;) {
          await new Promise((r) => setTimeout(r, 15000));
          const st = await engine.status(handle.jobId);
          const pct = st.progress !== undefined ? ` (${Math.round(st.progress * 100)}%)` : "";
          console.log(`[${engine.name}] ${st.state}${pct}`);
          if (st.state === "failed") throw new Error(st.error || `b-roll job for "${shotId}" failed`);
          if (st.state === "done") break;
        }
        const dest = path.join(footageDir, `${shotId}.mp4`);
        await engine.fetchOutput(handle.jobId, dest);
        console.log(`[${engine.name}] clip for "${shotId}" saved to ${dest}`);
      }
      console.log("All b-roll rendered. Wire clips into AnalogyInset src fields by hand, then re-assemble with --install.");
    },
  );

program
  .command("engine-test")
  .description("Render one clip through a VideoEngine (smoke test for the GPU render loop)")
  .argument("<prompt>", "Text-to-video prompt for the clip")
  .option("--engine <name>", "which engine to drive", "null")
  .option("--seconds <seconds>", "clip duration in seconds", "5")
  .option("--seed <seed>", "optional integer seed")
  .option("--out <dir>", "where to write the fetched clip", "out/gpu-test")
  .action(
    async (prompt: string, options: { engine: string; seconds: string; seed?: string; out: string }) => {
      const engine = createEngine(options.engine);
      const spec = {
        prompt,
        seconds: Number(options.seconds),
        width: 832,
        height: 480,
        fps: 16,
        ...(options.seed !== undefined ? { seed: Number(options.seed) } : {}),
        modelProfile: "small" as const,
      };
      console.log(`[${engine.name}] submitting job: "${prompt}"`);
      const handle = await engine.submit(spec);
      console.log(`[${engine.name}] job ${handle.jobId} submitted; polling status...`);
      // Poll until terminal state. Renders run under tmux remotely, so a dropped
      // local process never kills the GPU work; re-running resumes at poll stage.
      for (;;) {
        await new Promise((r) => setTimeout(r, 15000));
        const st = await engine.status(handle.jobId);
        const pct = st.progress !== undefined ? ` (${Math.round(st.progress * 100)}%)` : "";
        console.log(`[${engine.name}] ${st.state}${pct}`);
        if (st.state === "failed") throw new Error(st.error || "job failed");
        if (st.state === "done") break;
      }
      const dest = path.join(ROOT, options.out, `${handle.jobId}.mp4`);
      await engine.fetchOutput(handle.jobId, dest);
      console.log(`[${engine.name}] clip saved to ${dest}`);
    },
  );

// parseAsync, so a rejected action surfaces as a one-line CLI error rather than
// an unhandled rejection with a raw stack trace, and exits non-zero.
program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
