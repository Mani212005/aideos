/**
 * File Description: Vision-judge repair loop for SVG scene assets.
 * Renders a candidate SVG with headless Chrome, judges the still against its intent with the
 * shared Jev decision client, and retries with validator plus judge failures fed back to the
 * model, mirroring the generate-validate-repair shape in generateSvg.ts.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findChromeBinary } from "./renderStill";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { collectSvgElementIds, parseSvgDocument } from "../../src/dl/scene/svgDocument";
import {
  judgeVisionStill,
  type JevDecisionOptions,
  type VisionJudgeInput,
  type VisionJudgeResult,
} from "../jev";
import {
  buildRepairPrompt,
  buildSvgAssetPrompt,
  cleanCodeFence,
  validateGeneratedSvgAsset,
  type SvgGenerationOptions,
} from "./generateSvg";

/** Options controlling the vision repair loop beyond the SVG synthesis options. */
export interface VisionRepairOptions extends SvgGenerationOptions {
  /** Human-readable intent the still must depict (defaults to visualDirection). */
  intent?: string;
  /** Minimum look-alike score that counts as a pass. Defaults to 0.7. */
  judgeThreshold?: number;
  /** Shot or clip ids the judge should know about. */
  clipIds?: string[];
  /** Asset ids the judge should know about. */
  assetIds?: string[];
}

/** One rejected vision repair attempt, kept so a failure can be explained. */
export interface VisionRepairAttempt {
  attempt: number;
  errors: string[];
  score?: number;
  pass?: boolean;
}

/** Outcome of the vision repair loop. Nothing is written unless the asset passes. */
export interface VisionRepairResult {
  success: boolean;
  filePath?: string;
  score?: number;
  errors?: string[];
  attempts: VisionRepairAttempt[];
  elementIds?: string[];
}

/** Injectable still rasterizer: SVG text plus intent context to PNG base64, or null when unavailable. */
export type StillRasterizer = (svgText: string) => Promise<string | null>;

/** Injectable vision judge: rendered PNG base64 plus intent to a score and reasons. */
export type VisionJudgeFn = (input: VisionJudgeInput) => Promise<VisionJudgeResult>;

// Reads a PNG file from disk as a base64 string for judge input.
export function pngBase64FromPngFile(pngPath: string): string {
  return fs.readFileSync(pngPath).toString("base64");
}

// Renders raw SVG text to a PNG base64 still with headless Chrome (never qlmanage).
export async function renderSvgTextToPngBase64(svgText: string, width = 1920, height = 1080): Promise<string | null> {
  const chromePath = findChromeBinary();
  if (!chromePath) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-vision-"));
  const svgPath = path.join(tmpDir, "candidate.svg");
  const pngPath = path.join(tmpDir, "candidate.png");
  try {
    fs.writeFileSync(svgPath, svgText, "utf8");
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-vision-chrome-"));
    try {
      spawnSync(
        chromePath,
        [
          "--headless=new",
          "--disable-gpu",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--no-first-run",
          "--no-default-browser-check",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          `--user-data-dir=${profile}`,
          `--screenshot=${pngPath}`,
          `--window-size=${width},${height}`,
          svgPath,
        ],
        { stdio: "ignore", timeout: 30000 },
      );
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
    if (!fs.existsSync(pngPath) || fs.statSync(pngPath).size < 1000) return null;
    return pngBase64FromPngFile(pngPath);
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Builds the vision repair prompt that feeds validator plus judge failures back to the model.
export function buildVisionRepairPrompt(
  basePrompt: string,
  rejectedSvg: string,
  validatorErrors: string[],
  judge: VisionJudgeResult,
  intent: string,
): string {
  const judgeLines =
    judge.pass || judge.reasons.length === 0
      ? [`Look-alike score ${(judge.score ?? 0).toFixed(2)} did not reach the threshold for intent: ${intent}`]
      : [`Look-alike score ${(judge.score ?? 0).toFixed(2)} for intent: ${intent}`, ...judge.reasons.map((r) => `Judge: ${r}`)];
  const combined = [...validatorErrors, ...judgeLines];
  return buildRepairPrompt(basePrompt, rejectedSvg, combined);
}

// Synthesizes an SVG scene asset with validator plus vision-judge repair retries.
export async function synthesizeSvgAssetWithVision(
  options: VisionRepairOptions,
  llmCaller: (prompt: string) => Promise<string>,
  targetDir?: string,
  deps?: {
    jevOptions?: JevDecisionOptions;
    rasterize?: StillRasterizer;
    judge?: VisionJudgeFn;
  },
): Promise<VisionRepairResult> {
  const intent = (options.intent || options.visualDirection).trim();
  const threshold = options.judgeThreshold ?? 0.7;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const basePrompt = buildSvgAssetPrompt(options);
  const rasterize = deps?.rasterize ?? renderSvgTextToPngBase64;
  const judgeFn: VisionJudgeFn =
    deps?.judge ?? ((input) => judgeVisionStill(input, deps?.jevOptions));
  const attempts: VisionRepairAttempt[] = [];
  let prompt = basePrompt;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string;
    try {
      raw = await llmCaller(prompt);
    } catch (err) {
      attempts.push({
        attempt,
        errors: [`Model call failed: ${err instanceof Error ? err.message : String(err)}`],
      });
      continue;
    }
    const cleaned = cleanCodeFence(raw);
    const validation = validateGeneratedSvgAsset(cleaned);
    if (!validation.valid) {
      attempts.push({ attempt, errors: validation.errors });
      prompt = buildRepairPrompt(basePrompt, cleaned, validation.errors);
      continue;
    }
    let pngBase64: string | null = null;
    try {
      pngBase64 = await rasterize(cleaned);
    } catch {
      pngBase64 = null;
    }
    if (!pngBase64) {
      return writeVisionSuccess(cleaned, options, targetDir, attempts, undefined);
    }
    const judgeInput: VisionJudgeInput = {
      pngBase64,
      intent,
      ...(options.clipIds ? { clipIds: options.clipIds } : {}),
      ...(options.assetIds ? { assetIds: options.assetIds } : { assetIds: [options.componentName] }),
    };
    let judged: VisionJudgeResult;
    try {
      judged = await judgeFn(judgeInput);
    } catch (err) {
      attempts.push({
        attempt,
        errors: [`Vision judge failed: ${err instanceof Error ? err.message : String(err)}`],
      });
      prompt = buildVisionRepairPrompt(basePrompt, cleaned, [], { score: 0, pass: false, reasons: [], source: "heuristic-fallback" }, intent);
      continue;
    }
    if (judged.pass && judged.score >= threshold) {
      return writeVisionSuccess(cleaned, options, targetDir, attempts, judged.score);
    }
    attempts.push({ attempt, errors: judged.reasons.length > 0 ? judged.reasons : [`Look-alike score ${judged.score.toFixed(2)} below ${threshold}`], score: judged.score, pass: judged.pass });
    prompt = buildVisionRepairPrompt(basePrompt, cleaned, [], judged, intent);
  }
  const lastErrors = attempts[attempts.length - 1]?.errors ?? ["No output produced."];
  return { success: false, errors: lastErrors, attempts };
}

// Collects element ids from an SVG document without throwing on malformed input.
function collectSvgElementIdsSafe(svgText: string): string[] {
  try {
    return collectSvgElementIds(parseSvgDocument(svgText));
  } catch {
    return [];
  }
}

// Writes an accepted SVG asset to disk and reports its element ids.
function writeVisionSuccess(
  svgText: string,
  options: VisionRepairOptions,
  targetDir: string | undefined,
  attempts: VisionRepairAttempt[],
  score: number | undefined,
): VisionRepairResult {
  const baseDir = targetDir || path.resolve(getVideosDir(), options.slug, "visuals");
  fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${options.componentName}.svg`);
  fs.writeFileSync(filePath, svgText, "utf8");
  return {
    success: true,
    filePath,
    ...(typeof score === "number" ? { score } : {}),
    attempts,
    elementIds: collectSvgElementIdsSafe(svgText),
  };
}
