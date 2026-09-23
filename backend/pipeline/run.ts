/**
 * File Description: The single programmatic entry point for producing an Aideos film. runProduction
 * takes a script and returns finished, verified mp4s, moving through intake, narration, design,
 * B-roll, assembly, render and verification. Each stage records a fingerprint of its inputs in the
 * package's run state, so a failure partway through resumes from the last good stage instead of
 * restarting from zero, and every failure is reported with the stage that produced it.
 */

import { designFilm } from "../designSpec/designer";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type { Film } from "../../src/dl/schema";
import { ensureRetimedAudio, produceAudioPipeline, type ProduceAudioResult } from "../audio";
import { hasScreenplayTags, parseClaudeScript } from "../scriptIntake";
import { createEngine } from "../engine";
import { traceBus } from "../agentBridge";
import { compileFilmFromScreenplayAsync, FOOTAGE_HEADROOM_SEC, type FootageRequest } from "./design";
import {
  PUBLIC_DIR,
  ROOT,
  packageDir,
  readActiveFilmSource,
  readFilm,
  restoreActiveFilmSource,
  setActiveFilm,
  slugify,
  wireFootageIntoFilm,
  writeFilm,
} from "./filmStore";
import { analyseAudio, contactSheet, describeVideo, renderFormat, FORMAT_SPECS } from "./render";
import {
  PRODUCTION_STAGES,
  ProductionError,
  type BrollClip,
  type ProductionFormat,
  type ProductionProgress,
  type ProductionRequest,
  type ProductionResult,
  type ProductionStage,
  type RenderedOutput,
  type RunState,
  type StageRecord,
} from "./types";

/** Called for every progress event a run emits. */
export type ProgressHandler = (event: ProductionProgress) => void;

/** Short stable hash of a stage's inputs, used to invalidate a cached stage on resume. */
function fingerprint(...parts: unknown[]): string {
  return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/** Where the run state for a package lives. */
function statePath(slug: string): string {
  return path.join(packageDir(slug), "run-state.json");
}

/** Loads previous run state, or an empty one when there is none. */
function loadState(slug: string, title: string): RunState {
  const file = statePath(slug);
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RunState;
      if (Array.isArray(parsed.stages)) return parsed;
    } catch {
      // A corrupt state file is not worth failing a run over; start clean.
    }
  }
  return { slug, title, updatedAt: new Date().toISOString(), stages: [], brollClips: [], outputs: [] };
}

/** Persists run state so the next invocation can resume. */
function saveState(state: RunState): void {
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(packageDir(state.slug), { recursive: true });
  fs.writeFileSync(statePath(state.slug), JSON.stringify(state, null, 2), "utf8");
}

/** Finds a stage's record in the run state, creating it if this is its first run. */
function stageRecord(state: RunState, stage: ProductionStage): StageRecord {
  let record = state.stages.find((s) => s.stage === stage);
  if (!record) {
    record = { stage, status: "pending" };
    state.stages.push(record);
  }
  return record;
}

/** Copies a file, creating the destination directory first. */
async function copyInto(from: string, toDir: string, name?: string): Promise<string> {
  await fsp.mkdir(toDir, { recursive: true });
  const dest = path.join(toDir, name ?? path.basename(from));
  await fsp.copyFile(from, dest);
  return dest;
}

/**
 * Expands a screenplay's visual direction into a self-contained text-to-video prompt.
 *
 * The generator sees only this string, so it has to carry the whole look: the design language's
 * dark canvas and single indigo accent, real camera motion, and an explicit ban on the text and
 * logos diffusion models like to hallucinate into a frame that already has typography over it.
 */
export function buildFootagePrompt(direction: string): string {
  const subject = direction.replace(/\b(b-?roll|footage|live action|generated video|cinematic plate)\b[:,]?\s*/gi, "").trim();
  return (
    `${subject}. Cinematic macro photography, slow deliberate camera movement, ` +
    "near-black background, deep indigo and violet key light, thin volumetric haze, " +
    "shallow depth of field, high contrast, photoreal, no text, no logos, no captions, no watermark"
  );
}

/** Negative prompt paired with every footage job. */
const FOOTAGE_NEGATIVE =
  "text, letters, words, captions, subtitles, watermark, logo, ui, interface, distorted faces, " +
  "extra limbs, low quality, blurry, oversaturated, flicker";

/** Drives one B-roll job to completion on the configured engine and fetches the clip. */
async function renderOneClip(
  engineName: string,
  request: FootageRequest,
  destPath: string,
  emit: (message: string, progress?: number) => void,
): Promise<void> {
  const engine = createEngine(engineName);
  const spec = {
    prompt: buildFootagePrompt(request.prompt),
    negativePrompt: FOOTAGE_NEGATIVE,
    seconds: request.seconds,
    width: 832,
    height: 480,
    fps: 16,
    modelProfile: "small" as const,
  };

  const handle = await engine.submit(spec);
  emit(`${request.shotId}: job ${handle.jobId} submitted`, 0);

  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 15000));
      const status = await engine.status(handle.jobId);
      if (status.state === "failed") throw new Error(status.error || `b-roll job for ${request.shotId} failed`);
      emit(`${request.shotId}: ${status.state}`, status.progress);
      if (status.state === "done") break;
    }
    await engine.fetchOutput(handle.jobId, destPath);
  } finally {
    // Be a good citizen on a shared box: never leave a tmux session behind.
    await engine.cancel(handle.jobId).catch(() => undefined);
  }
}

/**
 * Produces a complete film from a script.
 *
 * Returns only once both requested formats exist on disk and have been probed, so a caller that
 * gets a result back can trust every path in it.
 */
export async function runProduction(
  request: ProductionRequest,
  onProgress?: ProgressHandler,
): Promise<ProductionResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  const title = request.title?.trim() || "Untitled Aideos Film";
  const slug = request.slug?.trim() || slugify(title);
  const formats: ProductionFormat[] = request.formats?.length ? request.formats : ["long", "reel"];
  const outDir = path.resolve(ROOT, request.outDir ?? "out");
  const pkgDir = packageDir(slug);
  const resume = request.resume ?? true;
  const forced = new Set(request.force ?? []);

  // B-roll is opt-in, and deliberately so: a clip costs roughly ten minutes of shared GPU
  // time. Treating an unset flag as consent meant any caller that simply did not mention
  // b-roll - a test, an MCP client, a script - silently submitted jobs to the remote box
  // and then blocked polling them.
  const wantsBroll = request.broll === true;

  const state = loadState(slug, title);
  state.title = title;

  let current: ProductionStage = "intake";
  let narrationResult: ProduceAudioResult | null = null;
  let filmResult: Film | null = null;
  let clipResults: BrollClip[] = [];
  let outputResults: RenderedOutput[] = [];

  /** Assembles the result object from whatever the run has produced so far. */
  const buildResult = (stoppedAfter?: ProductionStage): ProductionResult => ({
    slug,
    title,
    packageDir: pkgDir,
    filmPath: path.join(pkgDir, "film.json"),
    scriptPath: path.join(pkgDir, "script.md"),
    voiceoverPath: path.join(pkgDir, "voiceover.wav"),
    captionsPath: path.join(pkgDir, "captions.vtt"),
    wordsPath: path.join(pkgDir, "voiceover_words.json"),
    ttsBackend: narrationResult?.ttsBackend ?? "none",
    durationSec: narrationResult?.totalAudioDuration ?? 0,
    shotCount: filmResult?.shots.length ?? 0,
    brollClips: clipResults,
    outputs: outputResults,
    stages: state.stages,
    warnings,
    ...(stoppedAfter ? { stoppedAfter } : {}),
  });

  /** True when the caller asked the run to end after this stage. */
  const shouldStop = (stage: ProductionStage) => request.stopAfter === stage;

  /** Maps production pipeline stages to unified trace phase categories. */
  const stageToPhase = (s: ProductionStage): string => {
    switch (s) {
      case "intake":
      case "design":
      case "assemble":
        return "authoring";
      case "narrate":
      case "render":
        return "synthesis";
      case "broll":
        return "broll";
      case "verify":
        return "validation";
      default:
        return "authoring";
    }
  };

  /** Emits one progress event, tagged with the stage that is speaking. */
  const emit = (stage: ProductionStage, status: ProductionProgress["status"], message: string, progress?: number) => {
    onProgress?.({ stage, status, message, progress, elapsedMs: Date.now() - startedAt });
    try {
      traceBus.recordStep({
        id: `prod-${slug}-${stage}`,
        phase: stageToPhase(stage),
        source: "pipeline",
        filmId: slug,
        title: `Pipeline: ${stage.toUpperCase()}`,
        description: message,
        status: status === "skipped" || status === "done" ? "done" : status === "failed" ? "failed" : "running",
        details: [
          `Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
          `Progress: ${progress !== undefined ? `${(progress * 100).toFixed(0)}%` : status}`,
        ],
      });
    } catch (_) {}
  };

  /**
   * Runs one stage, honouring resume. A stage whose recorded fingerprint still matches its
   * inputs is skipped; everything else runs, and its outcome is written to the run state
   * before the next stage starts, so a crash never loses completed work.
   */
  const runStage = async <T>(
    stage: ProductionStage,
    inputFingerprint: string,
    cached: () => T | null,
    work: () => Promise<T>,
  ): Promise<T> => {
    current = stage;
    const record = stageRecord(state, stage);

    if (resume && !forced.has(stage) && record.status === "done" && record.fingerprint === inputFingerprint) {
      const reused = cached();
      if (reused !== null) {
        record.status = "done";
        emit(stage, "skipped", "reusing the result from the previous run");
        return reused;
      }
    }

    record.status = "running";
    record.startedAt = new Date().toISOString();
    record.fingerprint = inputFingerprint;
    record.error = undefined;
    emit(stage, "running", `${stage} started`);

    try {
      const result = await work();
      record.status = "done";
      record.finishedAt = new Date().toISOString();
      record.durationMs = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
      saveState(state);
      emit(stage, "done", `${stage} complete`);
      return result;
    } catch (err) {
      record.status = "failed";
      record.finishedAt = new Date().toISOString();
      record.error = err instanceof Error ? err.message : String(err);
      saveState(state);
      emit(stage, "failed", record.error);
      throw err instanceof ProductionError ? err : new ProductionError(stage, record.error, err);
    }
  };

  try {
    // ---- intake: validate the script and park it in the package ------------------------------
    const script = request.script ?? "";
    await runStage(
      "intake",
      fingerprint(script, title, slug),
      () => (fs.existsSync(path.join(pkgDir, "script.md")) ? true : null),
      async () => {
        if (!script.trim()) throw new Error("no script was provided; the pipeline has nothing to narrate");
        if (!hasScreenplayTags(script)) {
          warnings.push(
            "the script carries no [VISUAL]/[NARRATION]/[ON SCREEN] tags, so the design stage has no " +
              "on-screen copy or visual direction to work from and will fall back to bare canvas shots",
          );
        }
        const sections = parseClaudeScript(script);
        if (sections.length === 0) throw new Error("the script parsed into zero sections");
        await fsp.mkdir(pkgDir, { recursive: true });
        await fsp.writeFile(path.join(pkgDir, "script.md"), script, "utf8");
        emit("intake", "running", `${sections.length} section(s) parsed`);
        return true;
      },
    );
    if (shouldStop("intake")) return buildResult("intake");

    // ---- narrate: synthesize the voiceover and derive the timing spine -----------------------
    const narrationFingerprint = fingerprint(script, request.ttsBackend ?? "auto", request.voice ?? "default", request.speed ?? 1);
    const narrationCachePath = path.join(pkgDir, "narration.json");

    const narration = await runStage<ProduceAudioResult>(
      "narrate",
      narrationFingerprint,
      () => {
        if (!fs.existsSync(narrationCachePath) || !fs.existsSync(path.join(pkgDir, "voiceover.wav"))) return null;
        try {
          return JSON.parse(fs.readFileSync(narrationCachePath, "utf8")) as ProduceAudioResult;
        } catch {
          return null;
        }
      },
      async () => {
        const result = await produceAudioPipeline(script, pkgDir, {
          backend: request.ttsBackend,
          voice: request.voice,
          speed: request.speed,
          syncToPreview: request.syncToPreview,
          onProgress: (done, total, label) =>
            emit("narrate", "running", `synthesizing ${done}/${total}: "${label}"`, done / total),
        });
        await fsp.writeFile(narrationCachePath, JSON.stringify(result, null, 2), "utf8");
        emit(
          "narrate",
          "running",
          `${result.segments.length} segment(s), ${result.totalAudioDuration.toFixed(2)}s via ${result.ttsBackend}`,
        );
        return result;
      },
    );
    narrationResult = narration;
    if (shouldStop("narrate")) return buildResult("narrate");

    // ---- design: compile the screenplay and the timing spine into a film ---------------------
    // A run must never message a live agent session from inside the test runner.
    const bespoke = request.bespoke ?? !process.env.NODE_TEST_CONTEXT;
    const designFingerprint = fingerprint(script, narration.shotDurations, request.music ?? null, wantsBroll, bespoke);

    const design = await runStage(
      "design",
      designFingerprint,
      () => {
        const film = readFilm(slug);
        return film ? { film, footage: [] as FootageRequest[] } : null;
      },
      async () => {
        const compiled = await compileFilmFromScreenplayAsync(script, narration.segments, narration.shotDurations, {
          title,
          slug,
          maxFootageShots: wantsBroll ? (request.brollMaxClips ?? 4) : 0,
          maxFootageSec: request.brollSeconds ?? 8,
          ...(request.music ? { music: { src: request.music, volume: 0.5, duckUnderVoiceover: true } } : {}),
        });
        writeFilm(slug, compiled.film);
        emit(
          "design",
          "running",
          `${compiled.film.shots.length} shots, ${compiled.film.canvas.nodes.length} nodes, ` +
            `${compiled.footage.length} shot(s) flagged for footage`,
        );
        if (bespoke) {
          const outcome = await designFilm(slug, {
            agentTimeoutMs: request.designAgentTimeoutMs,
            llmCaller: request.designLlmCaller,
            onProgress: (message) => emit("design", "running", message),
          });
          emit("design", "running", `design: ${outcome.note}`);
          if (outcome.source === "templates") warnings.push(outcome.note);
          const designed = readFilm(slug);
          if (designed) return { ...compiled, film: designed };
        }
        return compiled;
      },
    );
    filmResult = design.film;
    if (shouldStop("design")) return buildResult("design");

    // ---- broll: render footage on the GPU and wire it into the film --------------------------
    // On a resume the design stage is cached, so its footage requests have to be rebuilt from
    // the film. They are rebuilt the same way the design stage builds them - same budget, same
    // headroom - because a request that differs returns a clip the assemble stage then drops.
    const footageBudget = request.brollSeconds ?? 8;
    const footageRequests = !wantsBroll
      ? []
      : design.footage.length > 0
        ? design.footage
        : readFilm(slug)?.shots
            .filter((s) => s.needsFootage)
            .map((s) => ({
              shotId: s.id,
              prompt: s.visualDirection ?? s.scriptText ?? "",
              seconds: Math.min(footageBudget, Math.max(3, s.dur + FOOTAGE_HEADROOM_SEC)),
            })) ?? [];

    const brollClips = await runStage<BrollClip[]>(
      "broll",
      fingerprint(footageRequests, wantsBroll, request.brollEngine ?? "ssh-wangp"),
      () => (state.brollClips.length > 0 && state.brollClips.every((c) => fs.existsSync(c.path)) ? state.brollClips : null),
      async () => {
        if (!wantsBroll || footageRequests.length === 0) {
          emit("broll", "running", "no footage requested");
          return [];
        }
        const engineName = request.brollEngine ?? "ssh-wangp";
        const footageDir = path.join(pkgDir, "footage");
        await fsp.mkdir(footageDir, { recursive: true });

        const clips: BrollClip[] = [];
        for (const [index, job] of footageRequests.entries()) {
          const dest = path.join(footageDir, `${job.shotId}.mp4`);
          if (fs.existsSync(dest)) {
            emit("broll", "running", `${job.shotId}: reusing the clip already on disk`);
          } else {
            emit("broll", "running", `rendering clip ${index + 1}/${footageRequests.length} for ${job.shotId}`,
              index / footageRequests.length);
            await renderOneClip(engineName, job, dest, (message, progress) =>
              emit("broll", "running", message, (index + (progress ?? 0)) / footageRequests.length));
          }
          const probe = describeVideo("long", dest);
          clips.push({
            shotId: job.shotId,
            prompt: job.prompt,
            path: dest,
            // public/videos is a symlink to videos/, so this is what staticFile() resolves.
            staticPath: `videos/${slug}/footage/${job.shotId}.mp4`,
            durationSec: probe.durationSec,
            width: probe.width,
            height: probe.height,
          });
        }
        state.brollClips = clips;
        return clips;
      },
    );
    clipResults = brollClips;
    if (shouldStop("broll")) return buildResult("broll");

    // ---- assemble: wire footage in, install as the active film, validate ---------------------
    const assembled = await runStage<Film>(
      "assemble",
      // Fingerprinted on the compiled film itself, not on the inputs that produced it: a
      // change to the design compiler produces a different film from identical inputs, and
      // hashing the inputs alone let a stale assembly survive the change.
      fingerprint(design.film, brollClips.map((c) => c.staticPath)),
      () => readFilm(slug),
      async () => {
        let film = readFilm(slug);
        if (!film) throw new Error(`design produced no film for "${slug}"`);

        for (const clip of brollClips) {
          const shot = film.shots.find((s) => s.id === clip.shotId);
          if (!shot) {
            warnings.push(`clip for "${clip.shotId}" has no matching shot and was not wired in`);
            continue;
          }
          if (clip.durationSec + 0.05 < shot.dur) {
            warnings.push(
              `clip for "${clip.shotId}" is ${clip.durationSec.toFixed(2)}s but its shot runs ` +
                `${shot.dur.toFixed(2)}s; the tail would render black, so the clip was dropped`,
            );
            continue;
          }
          // The caption the design stage already put on the placeholder inset came from the
          // screenplay's on-screen copy. The visual direction is an instruction to the
          // generator, and printing it under the plate puts a stage direction on screen.
          const existing = shot.blocks.find((b) => b.c === "AnalogyInset");
          const caption = existing && "caption" in existing ? existing.caption : shot.ch ?? "";
          film = wireFootageIntoFilm(slug, clip.shotId, clip.staticPath, caption);
        }

        const wired = film.shots.filter((s) => s.blocks.some((b) => b.c === "AnalogyInset" && Boolean(b.src))).length;
        emit("assemble", "running", `${wired} shot(s) carry B-roll`);
        return film;
      },
    );
    filmResult = assembled;
    if (shouldStop("assemble")) return buildResult("assemble");

    // ---- render: produce the deliverables ----------------------------------------------------
    const renderFingerprint = fingerprint(
      assembled,
      formats,
      brollClips.map((c) => c.staticPath),
    );

    const outputs = await runStage<RenderedOutput[]>(
      "render",
      renderFingerprint,
      () => {
        const cached = state.outputs.filter((o) => formats.includes(o.format));
        return cached.length === formats.length && cached.every((o) => fs.existsSync(o.path)) ? cached : null;
      },
      async () => {
        // Remotion's CLI bundles whichever film src/dl/activeFilm.ts names, so pointing it at
        // this run is part of rendering. It happens here rather than during assembly because
        // assembly is reached by runs that stop before rendering, and those must not leave the
        // repository pointing at a film nothing ever rendered.
        ensureRetimedAudio(assembled);
        setActiveFilm(slug);

        const produced: RenderedOutput[] = [];
        for (const format of formats) {
          const outPath = path.join(outDir, `${slug}-${format}.mp4`);
          emit("render", "running", `rendering ${format} (${FORMAT_SPECS[format].width}x${FORMAT_SPECS[format].height})`);
          const output = await renderFormat(format, outPath, {
            onLog: (message, progress) => emit("render", "running", message, progress),
          });
          produced.push(output);
        }
        state.outputs = produced;
        return produced;
      },
    );
    outputResults = outputs;
    if (shouldStop("render")) return buildResult("render");

    // ---- verify: probe what actually came out ------------------------------------------------
    await runStage(
      "verify",
      fingerprint(outputs.map((o) => [o.path, o.sizeBytes])),
      () => null,
      async () => {
        if (request.skipVerify) {
          emit("verify", "running", "skipped at the caller's request");
          return true;
        }
        const reviewDir = path.join(ROOT, "out", "review", slug);
        await fsp.mkdir(reviewDir, { recursive: true });

        for (const output of outputs) {
          const spec = FORMAT_SPECS[output.format];
          if (output.width !== spec.width || output.height !== spec.height) {
            warnings.push(
              `${output.format} rendered at ${output.width}x${output.height}, expected ${spec.width}x${spec.height}`,
            );
          }
          const expected = narration.totalAudioDuration;
          if (Math.abs(output.durationSec - expected) > 1.0) {
            warnings.push(
              `${output.format} runs ${output.durationSec.toFixed(2)}s but the narration is ` +
                `${expected.toFixed(2)}s; picture and voice are not the same length`,
            );
          }

          const audio = analyseAudio(output.path);
          if (audio.channels === 0) {
            warnings.push(`${output.format} has no audio stream`);
          }
          if (audio.peakDb > -0.5) {
            warnings.push(`${output.format} peaks at ${audio.peakDb.toFixed(2)} dBFS; that is clipping territory`);
          }
          const longSilence = audio.silences.find((s) => s.durationSec > 2.5);
          if (longSilence) {
            warnings.push(
              `${output.format} has ${longSilence.durationSec.toFixed(1)}s of silence at ` +
                `${longSilence.startSec.toFixed(1)}s`,
            );
          }

          contactSheet(output.path, path.join(reviewDir, `${output.format}-sheet.jpg`), { count: 12, columns: 4 });
          emit("verify", "running", `${output.format}: peak ${audio.peakDb.toFixed(1)} dBFS, contact sheet written`);
        }
        return true;
      },
    );

    saveState(state);
    return buildResult();
  } catch (err) {
    saveState(state);
    throw err instanceof ProductionError
      ? err
      : new ProductionError(current, err instanceof Error ? err.message : String(err), err);
  }
}

/** Every stage name, in order. Exported so callers can render a progress UI without guessing. */
export const stages = PRODUCTION_STAGES;

/** Copies the narration and captions into public/ for tooling that reads them from there. */
export async function mirrorNarrationToPublic(slug: string): Promise<void> {
  const dir = packageDir(slug);
  for (const name of ["voiceover.wav", "captions.vtt"]) {
    const from = path.join(dir, name);
    if (fs.existsSync(from)) await copyInto(from, PUBLIC_DIR, name);
  }
}

/** Restores src/dl/activeFilm.ts to a previously captured body. Used when a run must not stick. */
export { readActiveFilmSource, restoreActiveFilmSource };
