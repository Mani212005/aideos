/**
 * File Description: The single programmatic entry point for producing an Aideos film. runProduction
 * takes a script and returns authoring next steps or verified mp4s, moving through intake, narration, look, design,
 * B-roll, assembly, render and verification. Each stage records a fingerprint of its inputs in the
 * package's run state, so a failure partway through resumes from the last good stage instead of
 * restarting from zero, and every failure is reported with the stage that produced it.
 * Inputs and outputs: ProductionRequest -> executed pipeline stages and ProductionResult.
 * Used by: backend/cli.ts, backend/mcp/server.ts.
 */

import { designFilm, planFilmLook } from "../designSpec/designer";
import { prepareDefaultSoundtrack } from "../defaultSoundtrack";
import { buildDesign, designDir, formatBuildStatus, readCheckedLookPlan } from "../designSpec/build";
import { designSpecSchema } from "../designSpec/spec";
import { DOT_RESOURCES, STAGE_RESOURCES, STAGE_RESOURCE_HASH, CEL_TREATMENT } from "../../src/dl/scene/rigs/registry";
import { resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import { characterCandidates } from "../characters/library";
import type { LookPlan } from "../lookPlan/schema";
import { designAcceptance } from "../lookPlan/contract";
import { writeLookMd } from "../lookPlan/render";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type { Film } from "../../src/dl/schema";
import { produceAudioPipeline, type ProduceAudioResult } from "../audio";
import { DEFAULT_KOKORO_SPEED } from "../tts";
import { DELIVERY_CONFIG, deliveryTimeline } from "../../src/dl/delivery";
import { ensureEndCardVoice, narrationVoiceOf, synthesizeEndCardLine } from "../endCard/voice";
import { readRecordedNarration } from "./recordedNarration";
import { deliverReel } from "../reelCut/writer";
import { reelForRender, reelSourceFingerprint, writeReelFilm } from "../reelCut/store";
import { parseClaudeScript, plainTextToTaggedScript } from "../scriptIntake";
import { createEngine } from "../engine";
import { traceBus } from "../agentBridge";
import { compileFilmFromScreenplayAsync, FOOTAGE_HEADROOM_SEC, type FootageRequest } from "./design";
import { defaultDeviceCaller } from "./deviceData";
import { writeVisualChoices } from "./visualChoices";
import {
  ROOT,
  packageDir,
  readActiveFilmSource,
  readFilm,
  restoreActiveFilmSource,
  slugify,
  writeFilm,
  withFootage,
} from "./filmStore";
import { analyseAudio, contactSheet, describeVideo, FORMAT_SPECS } from "./render";
import { writeDescriptionCredits } from "../masterAudio";
import { assertDeliverable } from "../deliveryGate";
import { filmEditState } from "../filmAcceptance/store";
import { boundTheme } from "../../src/projectTheme";
import { createRenderJob } from "../renderJob";
import { createRemotionRenderer } from "../remotionRenderer";
import { createRunMachine, inputNeeded, isInputNeeded, type InputNeeded } from "./runMachine";
import { loadRunState, saveRunState } from "./runState";
import {
  PRODUCTION_STAGES,
  DESIGN_MODES,
  ProductionError,
  type BrollClip,
  type ProductionFormat,
  type ProductionProgress,
  type ProductionRequest,
  type ProductionResult,
  type ProductionStage,
  type RenderedOutput,
} from "./types";

/** Called for every progress event a run emits. */
export type ProgressHandler = (event: ProductionProgress) => void;

/** Short stable hash of a stage's inputs, used to invalidate a cached stage on resume. */
function fingerprint(...parts: unknown[]): string {
  return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

// Carries the existing film's authored soundtrack, music and legacy sfx onto a rebuilt film that lacks them.
function carryExistingSound(existing: Film | null | undefined, rebuilt: Film): void {
  if (existing?.soundtrack && !existing.soundtrack.defaultScore) rebuilt.soundtrack = existing.soundtrack;
  if (existing?.music && !rebuilt.music) rebuilt.music = existing.music;
  if (existing?.sfx?.length && !rebuilt.sfx?.length) rebuilt.sfx = existing.sfx;
}

// Hashes authored design inputs so a valid SVG or spec edit also reopens downstream production.
export function designFilesFingerprint(slug: string, options: { receiveSourceFile?: string } = {}): string | null {
  const specFile = path.join(designDir(slug), "design.json");
  if (!fs.existsSync(specFile)) return null;
  const raw = fs.readFileSync(specFile, "utf8");
  try {
    const parsed = designSpecSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return fingerprint(raw);
    const files = [...parsed.data.assets.flatMap((a) => "file" in a ? [a.file] : []), ...(parsed.data.background ? [parsed.data.background.file] : [])];
    const dots = "performances" in parsed.data && (parsed.data.treatment === "dots-v1" || parsed.data.assets.some((asset) => "treatment" in asset && asset.treatment === "dots-v1") || Object.values(parsed.data.shots ?? {}).some((shot) => shot.stageTreatment === "dots-v1"));
    const resources = "performances" in parsed.data ? Object.keys({ ...STAGE_RESOURCES, ...(dots ? DOT_RESOURCES : {}) }).map((file) => {
      const absolute = resolveRepoAssetPath(file);
      return [file, fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null];
    }) : null;
    const wordsFile = path.join(packageDir(slug), "voiceover_words.json");
    const timing = "performances" in parsed.data && fs.existsSync(wordsFile) ? fs.readFileSync(wordsFile, "utf8") : null;
    const needsReceiveSource = "performances" in parsed.data && parsed.data.performances.some((performance) => performance.action === "receive-v1");
    const receiveSourceFile = needsReceiveSource ? options.receiveSourceFile ?? characterCandidates("iona").find((candidate) => fs.existsSync(candidate)) : undefined;
    const receiveSource = receiveSourceFile ? [receiveSourceFile, fs.existsSync(receiveSourceFile) ? fs.readFileSync(receiveSourceFile, "utf8") : null] : null;
    // A changed character spec (rig, material, face, parts) reopens design even when design.json is unchanged.
    const characters = parsed.data.assets.flatMap((a) => ("kind" in a && a.kind === "character" ? [a.character] : [])).map((id) => {
      const file = characterCandidates(id, packageDir(slug)).find((candidate) => fs.existsSync(candidate));
      return [id, file ? fs.readFileSync(file, "utf8") : null];
    });
    return fingerprint(raw, resources, timing, receiveSource, STAGE_RESOURCE_HASH, CEL_TREATMENT, ...(characters.length ? [characters] : []), files.map((file) => {
      const absolute = path.join(packageDir(slug), file);
      return [file, fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null];
    }));
  } catch { return fingerprint(raw); }
}

// Hashes the look plan together with every character it names, so a character edit changes the design stage's look input.
export function lookPlanFingerprint(slug: string): string | null {
  const file = path.join(designDir(slug), "look.json");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  let ids: string[] = [];
  try {
    const plan = JSON.parse(raw) as { film?: { cast?: Array<{ character?: unknown; asset?: unknown }>; performances?: Array<{ character?: { id?: unknown } }> } };
    ids = [
      ...(plan.film?.cast ?? []).map((item) => item.character ?? (item.asset === "iona-art-v1" ? "iona" : undefined)),
      ...(plan.film?.performances ?? []).map((p) => p.character?.id),
    ].filter((id): id is string => typeof id === "string" && /^[a-z][a-z0-9-]*$/.test(id));
  } catch { return fingerprint(raw); }
  // A spec that no longer verifies still changes the key through its bytes, so a broken edit never reuses old work.
  const characters = [...new Set(ids)].sort().map((id) => {
    const candidate = characterCandidates(id, packageDir(slug)).find((c) => fs.existsSync(c));
    return [id, candidate ? crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex") : null];
  });
  return fingerprint(raw, characters);
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
 * Stops with actionable authoring steps when look/design needs input, or returns probed outputs
 * after both requested formats have been rendered. stopAfter supports partial authoring runs.
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
  const pkgDir = packageDir(slug);
  const outDir = request.outDir ? path.resolve(ROOT, request.outDir) : path.join(pkgDir, "renders");
  const resume = request.resume ?? true;
  const forced = new Set(request.force ?? []);
  const mode = request.bespoke === false ? "templates" : request.design ?? "inline";
  if (!(DESIGN_MODES as readonly string[]).includes(mode)) throw new ProductionError("look", `invalid design mode "${mode}"; use ${DESIGN_MODES.join(", ")}`);
  const delivery = {
    mode, skipAgent: request.skipAgent ?? Boolean(process.env.NODE_TEST_CONTEXT),
    agentTimeoutMs: request.designAgentTimeoutMs, llmCaller: request.designLlmCaller,
    judgeRunner: request.designJudgeRunner,
    ...(request.ownerKey ? { ownerKey: request.ownerKey } : {}),
  };

  // B-roll is opt-in, and deliberately so: a clip costs roughly ten minutes of shared GPU
  // time. Treating an unset flag as consent meant any caller that simply did not mention
  // b-roll - a test, an MCP client, a script - silently submitted jobs to the remote box
  // and then blocked polling them.
  const wantsBroll = request.broll === true;

  const runId = crypto.randomUUID();
  const owner = { pid: process.pid, runId };
  const loaded = loadRunState(slug, title, runId);
  const state = loaded.state;
  state.title = title;
  const machine = createRunMachine(state, saveRunState);
  warnings.push(...loaded.notices);

  let current: ProductionStage = "intake";
  let narrationResult: ProduceAudioResult | null = null;
  let filmResult: Film | null = null;
  let clipResults: BrollClip[] = [];
  let outputResults: RenderedOutput[] = [];

  /** Assembles the result object from whatever the run has produced so far. */
  const buildResult = (stoppedAfter?: ProductionStage): ProductionResult => ({
    status: stoppedAfter ? "stopped" : "completed",
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
    ...(state.designJudge ? { designJudge: state.designJudge } : {}),
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
   * Runs one stage through the run state machine, honouring resume. A stage whose recorded
   * fingerprint still matches its inputs is reused; everything else runs, and every transition
   * (including `running`) is saved before the work continues. A stage that needs authoring input
   * returns an InputNeeded value (a state, not an exception); a failure throws a ProductionError.
   */
  const runStage = async <T>(
    stage: ProductionStage,
    inputFingerprint: string,
    cached: () => T | null,
    work: () => Promise<T | InputNeeded>,
    completedFingerprint?: () => string,
    refreshedFingerprints?: () => Array<{ stage: ProductionStage; fingerprint: string }>,
  ): Promise<T | InputNeeded> => {
    current = stage;
    const record = machine.record(stage);

    if (resume && !forced.has(stage) && record.status === "done" && record.fingerprint === inputFingerprint) {
      const reused = cached();
      if (reused !== null) {
        machine.reuse(stage);
        emit(stage, "skipped", "reusing the result from the previous run");
        return reused;
      }
    }

    if (PRODUCTION_STAGES.indexOf(stage) <= PRODUCTION_STAGES.indexOf("design")) state.designJudge = undefined;

    // A stage that runs again invalidates every later stage, even if its output hashes identically.
    // Forced narration/design must not leave a completed assembly or render attached to old inputs.
    machine.begin(stage, inputFingerprint, owner);
    emit(stage, "running", `${stage} started`);

    try {
      const result = await work();
      if (isInputNeeded(result)) {
        machine.needInput(stage, result.message);
        emit(stage, "needs_input", result.message);
        return result;
      }
      machine.complete(stage, completedFingerprint?.() ?? inputFingerprint, refreshedFingerprints?.());
      emit(stage, "done", `${stage} complete`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      machine.fail(stage, message);
      emit(stage, "failed", message);
      throw err instanceof ProductionError ? err : new ProductionError(stage, message, err);
    }
  };

  /** Runs a stage that can never ask for authoring input (its work returns a plain value). */
  const runPlainStage = async <T>(
    stage: ProductionStage,
    inputFingerprint: string,
    cached: () => T | null,
    work: () => Promise<T>,
    completedFingerprint?: () => string,
    refreshedFingerprints?: () => Array<{ stage: ProductionStage; fingerprint: string }>,
  ): Promise<T> => {
    const result = await runStage<T>(stage, inputFingerprint, cached, work, completedFingerprint, refreshedFingerprints);
    if (isInputNeeded(result)) throw new ProductionError(stage, "stage returned an input request but cannot accept one");
    return result;
  };

  /** Ends the run at a stage that needs authoring input, with the exact continuation steps. */
  const haltForInput = (needed: InputNeeded): ProductionResult => {
    filmResult = readFilm(slug);
    return { ...buildResult(), status: needed.status, nextSteps: needed.nextSteps };
  };

  try {
    // ---- intake: validate the script and park it in the package ------------------------------
    // A plain-text story is converted to the internal tagged script right here, deterministically and with no
    // agent, so the user's narration is never reformatted later; a tagged script passes through unchanged.
    const script = plainTextToTaggedScript(request.script ?? "", { speed: request.speed ?? DEFAULT_KOKORO_SPEED });
    await runPlainStage(
      "intake",
      fingerprint(script, title, slug),
      () => (fs.existsSync(path.join(pkgDir, "script.md")) ? true : null),
      async () => {
        if (!script.trim()) throw new Error("no script was provided; the pipeline has nothing to narrate");
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
    const narrationFingerprint = fingerprint(script, request.ttsBackend ?? "auto", request.voice ?? "default", request.speed ?? DEFAULT_KOKORO_SPEED);
    const narrationCachePath = path.join(pkgDir, "narration.json");

    // A package that already carries narration spoken from this script (a recorded voice, or one made
    // before run-state.json existed or was copied along) is resumed as is: re-synthesizing it would
    // replace the voice and move every cue the design was timed to. A deliberate re-narration is force.
    const narrateRecord = machine.record("narrate");
    const recorded = resume && !forced.has("narrate") && !narrateRecord.fingerprint ? readRecordedNarration(pkgDir, script) : null;
    if (recorded) {
      machine.adopt("narrate", narrationFingerprint);
      emit("narrate", "running", `using the recorded narration in the package (voiceover.wav, ${recorded.totalAudioDuration.toFixed(2)}s, ${recorded.ttsBackend}); not synthesizing it again`);
    }

    const narration = await runPlainStage<ProduceAudioResult>(
      "narrate",
      narrationFingerprint,
      () => readRecordedNarration(pkgDir, script),
      async () => {
        const result = await produceAudioPipeline(script, pkgDir, {
          intakeSource: request.script ?? "",
          backend: request.ttsBackend,
          voice: request.voice,
          speed: request.speed,
          syncToPreview: request.syncToPreview,
          onProgress: (done, total, label) =>
            emit("narrate", "running", `synthesizing ${done}/${total}: "${label}"`, done / total),
          onIntakeNotice: (issue) => emit("narrate", "running", issue.message),
        });
        await fsp.writeFile(narrationCachePath, JSON.stringify(result, null, 2), "utf8");
        emit(
          "narrate",
          "running",
          `${result.segments.length} segment(s), ${result.totalAudioDuration.toFixed(2)}s via ${result.ttsBackend}`,
        );
        // The end card's spoken line, once, in the voice the story was just narrated in.
        const line = DELIVERY_CONFIG.endCard.spokenLine.trim();
        const voice = narrationVoiceOf(result);
        if (DELIVERY_CONFIG.endCard.enabled && line && voice) {
          try {
            const record = await synthesizeEndCardLine(pkgDir, line, voice);
            emit("narrate", "running", `end card line, ${record.durationSec.toFixed(2)}s`);
          } catch (err) {
            warnings.push(`end card line was not synthesized (${err instanceof Error ? err.message : String(err)}); the card stays silent`);
          }
        }
        return result;
      },
    );
    narrationResult = narration;
    if (shouldStop("narrate")) return buildResult("narrate");

    // ---- look: measured beats are available before the first picture is authored -------------
    const chosenTheme = boundTheme(readFilm(slug));
    const compileOptions = {
      title, slug,
      maxFootageShots: wantsBroll ? (request.brollMaxClips ?? 4) : 0,
      maxFootageSec: request.brollSeconds ?? 8,
      ...(request.music ? { music: { src: request.music, volume: 0.5, duckUnderVoiceover: true } } : {}),
      // A project created in the studio carries the theme the user chose; every recompile keeps it.
      ...(chosenTheme ? { theme: chosenTheme } : {}),
    };
    const lookFingerprint = fingerprint(script, narration.shotDurations, title, mode);
    const lookRun = await runStage<LookPlan | false>(
      "look", lookFingerprint,
      () => {
        if (mode === "templates") return false;
        const film = readFilm(slug);
        const plan = film ? readCheckedLookPlan(film).plan : undefined;
        if (plan) writeLookMd(slug);
        return plan ?? null;
      },
      async () => {
        if (mode === "templates") return false;
        const existing = readFilm(slug);
        const skeleton = await compileFilmFromScreenplayAsync(script, narration.segments, narration.shotDurations, {
          ...compileOptions, textOnly: true, maxFootageShots: 0,
        });
        carryExistingSound(existing, skeleton.film);
        writeFilm(slug, skeleton.film, { owner: false, protectHandEdits: true });
        filmResult = skeleton.film;
        const outcome = await planFilmLook(slug, { ...delivery, onProgress: (message) => emit("look", "running", message) });
        if (!outcome.plan) {
          warnings.push(outcome.note, ...outcome.errors);
          return inputNeeded("needs_look", [
            `Read ${path.join(designDir(slug), "LOOK_BRIEF.md")}`,
            `Write ${path.join(designDir(slug), "look.json")}`,
            `Run aideos look check ${slug}`,
            "Re-run the same command to continue.",
          ], outcome.note);
        }
        return outcome.plan;
      },
    );
    if (isInputNeeded(lookRun)) return haltForInput(lookRun);
    const look = lookRun;
    filmResult = readFilm(slug);
    if (shouldStop("look")) return buildResult("look");

    // ---- design: the accepted plan controls treatments and invalidates changed designs -------
    const lookHash = look ? lookPlanFingerprint(slug) : null;
    const designFingerprint = () => fingerprint(script, narration.shotDurations, request.music ?? null,
      wantsBroll, mode, lookHash, "look-contract-v1", "default-soundtrack-v1", mode === "templates" ? null : designFilesFingerprint(slug));

    const designRun = await runStage(
      "design",
      designFingerprint(),
      () => {
        if (!state.designJudge || designAcceptance(state.designJudge) === "needs_design") return null;
        if (mode !== "templates") {
          try {
            // Rebuild under the source that made the film, so an unchanged design writes an identical film and later stages stay reused.
            const source = readFilm(slug)?.design?.source;
            const status = buildDesign(slug, source === "server-model" || source === "hand-built" ? source : "agent");
            if (status.state !== "passed") {
              if (filmEditState(packageDir(slug)) === "hand-edited") throw new Error(status.errors.join("; "));
              return null;
            }
          } catch (err) {
            if (filmEditState(packageDir(slug)) === "hand-edited") throw err;
            return null;
          }
        }
        const film = readFilm(slug);
        return film && (mode === "templates" || (film.scene && film.design?.source !== "templates"))
          ? { film, footage: [] as FootageRequest[] } : null;
      },
      async () => {
        const compiled = await compileFilmFromScreenplayAsync(script, narration.segments, narration.shotDurations, {
          ...compileOptions,
          ...(look ? { lookPlan: look } : {}),
          deviceCaller: request.deviceCaller !== undefined ? request.deviceCaller : process.env.NODE_TEST_CONTEXT ? null : await defaultDeviceCaller(),
        });
        const existing = readFilm(slug);
        carryExistingSound(existing, compiled.film);
        writeFilm(slug, compiled.film, { owner: false, protectHandEdits: true });
        // Every new compile becomes the build's base. A stale first-build snapshot must never
        // resurrect narration, timing or treatments from an earlier run.
        fs.mkdirSync(designDir(slug), { recursive: true });
        fs.writeFileSync(path.join(designDir(slug), "base-film.json"), JSON.stringify(compiled.film, null, 2) + "\n");
        writeVisualChoices(slug, compiled.film, compiled.shotVisuals, compiled.deviceReports);
        emit(
          "design",
          "running",
          `${compiled.film.shots.length} shots, ${compiled.film.canvas.nodes.length} nodes, ` +
            `${compiled.footage.length} shot(s) flagged for footage`,
        );
        const outcome = await designFilm(slug, {
          ...delivery, onProgress: (message) => emit("design", "running", message),
        });
        state.designJudge = outcome.judge;
        emit("design", "running", `design: ${outcome.note}`);
        if (outcome.source === "needs_design" || outcome.judge && designAcceptance(outcome.judge) === "needs_design") {
          warnings.push(outcome.note);
          if (outcome.status) warnings.push(formatBuildStatus(slug, outcome.status));
          return inputNeeded("needs_design", [
            `Read ${path.join(designDir(slug), "BRIEF.md")}`,
            `Write ${path.join(designDir(slug), "design.json")} and its visuals/*.svg assets`,
            `Run aideos design build ${slug}`,
            "Re-run the same command to continue.",
          ], outcome.note);
        }
        const designed = readFilm(slug);
        if (!designed || (mode !== "templates" && !designed.scene)) throw new Error("design did not produce a scene film");
        return { ...compiled, film: designed };
      },
      () => designFingerprint(),
    );
    if (isInputNeeded(designRun)) return haltForInput(designRun);
    const design = designRun;
    const scoredDesign = await prepareDefaultSoundtrack(design.film, "long", (message) => {
      warnings.push(message);
      emit("design", "done", message);
    });
    if (scoredDesign !== design.film) design.film = writeFilm(slug, scoredDesign);
    filmResult = design.film;
    if (shouldStop("design")) return buildResult("design");

    // The reel fingerprint includes film.json, so finish its end-card input before recording the
    // reel stage. Assembly reuses this same value when it writes the long and reel films.
    try {
      const endCardLine = await ensureEndCardVoice(slug, { film: design.film });
      design.film = endCardLine.film;
      if (endCardLine.notice) warnings.push(`end card: ${endCardLine.notice}`);
    } catch (err) {
      warnings.push(`end card line could not be attached (${err instanceof Error ? err.message : String(err)}); the card stays silent`);
    }

    // ---- reel: same picture and voice, separate condensed narration when the long does not fit.
    const reelFingerprint = () => fingerprint(reelSourceFingerprint(slug), request.reel ?? mode, formats.includes("reel"));
    const reelRun = await runStage<Film | false>("reel", reelFingerprint(), () => {
      if (!formats.includes("reel")) return false;
      if (!fs.existsSync(path.join(pkgDir, "reel/status.json")) || !fs.existsSync(path.join(pkgDir, "reel/film.json"))) return null;
      try { return reelForRender(slug); } catch { return null; }
    }, async () => {
      if (!formats.includes("reel")) return false;
      const outcome = await deliverReel(slug, {
        ...delivery, mode: request.reel ?? (mode === "templates" ? "inline" : mode),
        llmCaller: request.reelLlmCaller !== undefined ? request.reelLlmCaller : request.designLlmCaller,
        synthesize: request.reelSynthesizer,
        onProgress: (message) => emit("reel", "running", message),
      });
      if (outcome.status === "needs_reel_cut") return inputNeeded(outcome.status, outcome.nextSteps, outcome.note);
      return outcome.film;
    }, () => reelFingerprint());
    if (isInputNeeded(reelRun)) return haltForInput(reelRun);
    let reelFilm = reelRun;
    if (shouldStop("reel")) return buildResult("reel");

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

    const brollClips = await runPlainStage<BrollClip[]>(
      "broll",
      fingerprint(footageRequests, wantsBroll, request.brollEngine ?? "ssh-wangp"),
      () => !wantsBroll || footageRequests.length === 0 ? [] :
        state.brollClips.length > 0 && state.brollClips.every((c) => fs.existsSync(c.path)) ? state.brollClips : null,
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
        return clips;
      },
    );
    state.brollClips = brollClips;
    machine.save();
    clipResults = brollClips;
    if (shouldStop("broll")) return buildResult("broll");

    // ---- assemble: wire footage in, install as the active film, validate ---------------------
    // Predict the deterministic wired output so a completed assembly is compared by its final films on resume.
    const footageForAssembly = (film: Film): Film => brollClips.reduce((current, clip) => {
      const shot = current.shots.find((candidate) => candidate.id === clip.shotId);
      if (!shot || clip.durationSec + 0.05 < shot.dur) return current;
      const inset = shot.blocks.find((block) => block.c === "AnalogyInset");
      const caption = inset && "caption" in inset ? inset.caption : shot.ch ?? "";
      return withFootage(current, clip.shotId, clip.staticPath, caption);
    }, film);
    const expectedAssembled = footageForAssembly(design.film);
    const expectedReel = reelFilm ? footageForAssembly(reelFilm) : false;
    const assemblyFingerprint = (long: Film, reel: Film | false) => fingerprint(
      withoutEndCardVoice(long), reel && withoutEndCardVoice(reel), brollClips.map((clip) => clip.staticPath),
    );
    let assembled = await runPlainStage<Film>(
      "assemble",
      assemblyFingerprint(expectedAssembled, expectedReel),
      () => readFilm(slug),
      async () => {
        for (const clip of brollClips) {
          const shot = design.film.shots.find((s) => s.id === clip.shotId);
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
        }

        const film = writeFilm(slug, expectedAssembled);
        if (expectedReel) reelFilm = writeReelFilm(slug, { ...expectedReel, endCardVoice: film.endCardVoice });
        const wired = film.shots.filter((s) => s.blocks.some((b) => b.c === "AnalogyInset" && Boolean(b.src))).length;
        emit("assemble", "running", `${wired} shot(s) carry B-roll`);
        return film;
      },
      () => assemblyFingerprint(readFilm(slug)!, reelFilm || false),
      () => [{ stage: "reel", fingerprint: reelFingerprint() }],
    );
    filmResult = assembled;
    if (shouldStop("assemble")) return buildResult("assemble");

    // ---- render: produce the deliverables ----------------------------------------------------
    const renderFingerprint = fingerprint(
      assembled,
      reelFilm,
      formats,
      brollClips.map((c) => c.staticPath),
      "master-audio-v1",
      // Partial renders have a separate cache identity.
      ...(request.renderFrames ? [request.renderFrames] : []),
    );

    const outputs = await runPlainStage<RenderedOutput[]>(
      "render",
      renderFingerprint,
      () => {
        const cached = state.outputs.filter((o) => formats.includes(o.format));
        return cached.length === formats.length && cached.every((o) => fs.existsSync(o.path)) ? cached : null;
      },
      async () => {
        // Keep the existing all-format deliverable preflight before producing any output.
        assertDeliverable(formats.map((format) => ({ film: format === "reel" ? reelForRender(slug) : assembled, format })));
        const produced: RenderedOutput[] = [];
        for (const format of formats) {
          const outputFilm = format === "reel" ? reelForRender(slug) : assembled;
          const outPath = request.outDir ? path.join(outDir, `${slug}-${format}.mp4`) : path.join(outDir, `${format}.mp4`);
          const job = createRenderJob({ film: outputFilm, format, outPath, profile: "final", frames: request.renderFrames }, createRemotionRenderer({
            caller: "pipeline", concurrency: request.renderConcurrency, browserExecutable: request.browserExecutable,
            onLog: (message, progress) => emit("render", "running", message, progress),
          }), { onLog: (message) => emit("render", "running", message) });
          const { output, master } = await job.run();
          if (master.status === "skipped") warnings.push(`${format} master skipped: ${master.reason}`);
          produced.push(output);
        }
        writeDescriptionCredits(path.join(pkgDir, "renders"), [assembled, ...(reelFilm ? [reelFilm] : [])]);
        state.outputs = produced;
        return produced;
      },
    );
    outputResults = outputs;
    if (shouldStop("render")) return buildResult("render");

    // ---- verify: probe what actually came out ------------------------------------------------
    await runPlainStage(
      "verify",
      fingerprint(outputs.map((o) => [o.path, o.sizeBytes])),
      () => null,
      async () => {
        if (request.skipVerify) {
          emit("verify", "running", "skipped at the caller's request");
          return true;
        }
        const reviewDir = path.join(pkgDir, "review");
        await fsp.mkdir(reviewDir, { recursive: true });

        for (const output of outputs) {
          const outputFilm = output.format === "reel" && reelFilm ? reelFilm : assembled;
          const spec = FORMAT_SPECS[output.format];
          if (output.width !== spec.width || output.height !== spec.height) {
            warnings.push(
              `${output.format} rendered at ${output.width}x${output.height}, expected ${spec.width}x${spec.height}`,
            );
          }
          const audio = analyseAudio(output.path);
          warnings.push(...deliveredOutputWarnings({
            film: outputFilm,
            format: output.format,
            durationSec: output.durationSec,
            narrationSec: outputFilm.voiceover?.durationSec ?? narration.totalAudioDuration,
            silences: audio.silences,
            renderFrames: request.renderFrames,
          }));
          if (audio.channels === 0) {
            warnings.push(`${output.format} has no audio stream`);
          }
          if (audio.peakDb > -0.5) {
            warnings.push(`${output.format} peaks at ${audio.peakDb.toFixed(2)} dBFS; that is clipping territory`);
          }

          contactSheet(output.path, path.join(reviewDir, `${output.format}-sheet.jpg`), { count: 12, columns: 4 });
          emit("verify", "running", `${output.format}: peak ${audio.peakDb.toFixed(1)} dBFS, contact sheet written`);
        }
        return true;
      },
    );

    machine.save();
    return buildResult();
  } catch (err) {
    throw err instanceof ProductionError
      ? err
      : new ProductionError(current, err instanceof Error ? err.message : String(err), err);
  } finally {
    // A stage this run still holds as running (an exit outside runStage) must not stay running on disk.
    machine.release(runId, "interrupted: the run ended before this stage finished");
  }
}

/**
 * The verify stage's length and silence findings for one rendered output. A full render runs the
 * narration plus the format's end card (src/dl/delivery.ts); a partial render (renderFrames) only
 * the window it was asked for. Only the story is held to having no long silence, because the end
 * card may be quiet by design.
 */
export function deliveredOutputWarnings(input: {
  film: Film;
  format: ProductionFormat;
  durationSec: number;
  narrationSec: number;
  silences: Array<{ startSec: number; durationSec: number }>;
  renderFrames?: [number, number];
}): string[] {
  const { film, format, durationSec, narrationSec, silences, renderFrames } = input;
  const warnings: string[] = [];
  const delivery = deliveryTimeline(film, format);
  const cardSec = delivery.card ? delivery.card.durationInFrames / delivery.fps : 0;
  const expected = renderFrames ? (renderFrames[1] - renderFrames[0] + 1) / film.fps : narrationSec + cardSec;
  if (Math.abs(durationSec - expected) > 1.0) {
    warnings.push(
      `${format} runs ${durationSec.toFixed(2)}s but the narration` +
        `${cardSec > 0 && !renderFrames ? ` plus the ${cardSec.toFixed(1)}s end card` : ""} is ` +
        `${expected.toFixed(2)}s; picture and voice are not the same length`,
    );
  }
  const storyEndSec = delivery.card && !renderFrames ? delivery.card.from / delivery.fps : Infinity;
  const longSilence = silences
    .map((s) => ({ startSec: s.startSec, durationSec: Math.min(s.startSec + s.durationSec, storyEndSec) - s.startSec }))
    .find((s) => s.durationSec > 2.5);
  if (longSilence) {
    warnings.push(`${format} has ${longSilence.durationSec.toFixed(1)}s of silence at ${longSilence.startSec.toFixed(1)}s`);
  }
  return warnings;
}

// The film minus its derived end card line, for fingerprints of what the design produced.
function withoutEndCardVoice(film: Film): Film {
  const rest = { ...film };
  delete rest.endCardVoice;
  return rest;
}

/** Every stage name, in order. Exported so callers can render a progress UI without guessing. */
export const stages = PRODUCTION_STAGES;

/** Restores src/dl/activeFilm.ts to a previously captured body. Used when a run must not stick. */
export { readActiveFilmSource, restoreActiveFilmSource };
