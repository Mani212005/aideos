/**
 * File Description: The design check - one pass that enforces the standard layer on any film.
 * However a film's design was made (hand-written builder, connected coding agent, server model or
 * templates), it has to pass this before it ships. Each finding names the rule, where it is, and
 * what to change, so an agent can be handed the report verbatim and repair its own design.
 * Rules: schema, scene engine validity, static self-contained artwork, palette, typography,
 * continuity (no motion snaps while visible, one origin per element), audio lock, and honest
 * on-screen data.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFilm, type Film } from "../../src/dl/schema";
import type { EnvironmentAsset, Scene } from "../../src/dl/scene/types";
import type { SvgAnimationClip } from "../../src/dl/scene/svgAnimation";
import { parseSvgDocument, walkSvgNodes } from "../../src/dl/scene/svgDocument";
import { validateSceneWithNodeAssets } from "../../src/dl/scene/validateSceneNode";
import { narrationSupportsVisual, numbersIn } from "../shotVisualCues";
import type { ShotVisual } from "../jev";
import { FPS } from "../sceneKit";

/** The standard layer rules a finding can belong to. */
export type DesignRule =
  | "schema"
  | "scene"
  | "static-art"
  | "palette"
  | "typography"
  | "continuity"
  | "origin"
  | "audio-lock"
  | "honest-data";

/** One problem found in a film's design. Errors block shipping; warnings are worth a look. */
export interface DesignFinding {
  rule: DesignRule;
  severity: "error" | "warning";
  where: string;
  message: string;
}

/** The result of checking one film. */
export interface DesignReport {
  filmId: string;
  ok: boolean;
  findings: DesignFinding[];
  stats: { shots: number; assets: number; clips: number };
}

/** The locked design-system palette (src/dl/README.md); a film may add its own accent. */
export const LOCKED_PALETTE = ["#0A0A0B", "#F5F5F5", "#8A8A8E", "#635BFF", "#101013"] as const;

/** Typefaces the design system allows. */
const ALLOWED_FONTS = /^(geist|jetbrains mono)$/i;

/** Elements that would make an asset animate itself or reach outside the package. */
const FORBIDDEN_TAGS = new Set(["script", "animate", "animateTransform", "animateMotion", "foreignObject", "set"]);

const REPO_ROOT = path.resolve(__dirname, "../..");

// Converts a #rgb or #rrggbb literal to its channels.
function hexChannels(hex: string): [number, number, number] {
  const full = hex.length === 4 ? `#${hex.slice(1).split("").map((c) => c + c).join("")}` : hex;
  const n = parseInt(full.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// True for greys, black and white, allowing a few units of tint (shadows, scrims, surfaces).
function isNeutral([r, g, b]: [number, number, number]): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) <= 4;
}

// Lists every chromatic colour in an asset that is neither in the palette nor the film's accent.
export function offPaletteColours(svgText: string, accent?: string): string[] {
  const allowed = [...LOCKED_PALETTE, ...(accent ? [accent] : [])].map((h) => hexChannels(h.toUpperCase()).join(","));
  const found = new Set<string>();
  const consider = (literal: string, rgb: [number, number, number]) => {
    if (isNeutral(rgb) || allowed.includes(rgb.join(","))) return;
    found.add(literal);
  };
  for (const m of svgText.matchAll(/#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g)) consider(m[0], hexChannels(m[0]));
  for (const m of svgText.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)[^)]*\)/g)) {
    consider(m[0], [Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return [...found];
}

// Checks one asset document is static, self-contained, on palette and in the allowed typefaces.
function checkAsset(asset: EnvironmentAsset, accent: string | undefined, findings: DesignFinding[]): void {
  if (!asset.svgSource) return;
  const file = path.resolve(REPO_ROOT, asset.svgSource);
  if (!fs.existsSync(file)) return; // The scene rule already reports a missing file.
  const text = fs.readFileSync(file, "utf8");
  const where = asset.svgSource;
  let doc;
  try {
    doc = parseSvgDocument(text);
  } catch {
    return; // The scene rule already reports an unparseable file.
  }
  const forbidden = new Set<string>();
  walkSvgNodes(doc, (node) => {
    if (FORBIDDEN_TAGS.has(node.tag)) forbidden.add(node.tag);
    for (const [name, value] of Object.entries(node.attrs)) {
      if ((name === "href" || name === "xlink:href" || name === "src") && /^(https?:|\/\/)/i.test(value)) {
        findings.push({ rule: "static-art", severity: "error", where, message: `<${node.tag}> loads "${value}" from outside the package; embed it instead.` });
      }
      if (name === "style" && /(transition|animation)\s*:/i.test(value)) {
        findings.push({ rule: "static-art", severity: "error", where, message: `<${node.tag}> declares CSS motion; move it into an animation clip.` });
      }
      if (name === "font-family" || (name === "style" && /font-family/i.test(value))) {
        const family = (name === "style" ? value.replace(/.*font-family\s*:\s*([^;]+).*/i, "$1") : value).split(",")[0].replace(/["']/g, "").trim();
        if (family && !ALLOWED_FONTS.test(family)) {
          findings.push({ rule: "typography", severity: "error", where, message: `uses the typeface "${family}"; only Geist and JetBrains Mono are allowed.` });
        }
      }
    }
  });
  for (const tag of forbidden) {
    findings.push({ rule: "static-art", severity: "error", where, message: `contains <${tag}>; assets are static and motion is authored as clips.` });
  }
  const off = offPaletteColours(text, accent);
  if (off.length) {
    findings.push({ rule: "palette", severity: "error", where, message: `uses colours outside the palette and the film accent: ${off.slice(0, 6).join(", ")}${off.length > 6 ? ", ..." : ""}.` });
  }
}

/** One target's view of a clip, with the stagger already applied. */
interface TargetClip {
  clipId: string;
  start: number;
  end: number;
  from: number;
  to: number;
}

// The state slots a property writes, which is the granularity continuity is checked at.
function slotsFor(property: string): string[] {
  return property === "scale" ? ["scaleX", "scaleY"] : [property];
}

// The value an element holds before any clip touches it.
function restValue(slot: string): number {
  return slot === "scaleX" || slot === "scaleY" || slot === "opacity" || slot === "drawOn" ? 1 : 0;
}

// Splits a timeline's clips into per-target, per-slot sequences ordered by start frame.
function perTargetSlots(clips: SvgAnimationClip[]): Map<string, TargetClip[]> {
  const out = new Map<string, TargetClip[]>();
  for (const clip of clips) {
    clip.targets.forEach((target, k) => {
      const start = clip.startFrame + (clip.staggerFrames ?? 0) * k;
      for (const slot of slotsFor(clip.property)) {
        const key = `${target}::${slot}`;
        const list = out.get(key) ?? [];
        list.push({ clipId: clip.clipId, start, end: start + clip.durationFrames, from: clip.from, to: clip.to });
        out.set(key, list);
      }
    });
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start);
  return out;
}

// The value a slot holds at a frame, from its ordered clips (linear inside a clip is close enough here).
function valueAt(list: TargetClip[] | undefined, slot: string, frame: number): number {
  let value = restValue(slot);
  for (const c of list ?? []) {
    if (c.start > frame) break;
    value = frame >= c.end ? c.to : c.from + ((c.to - c.from) * (frame - c.start)) / Math.max(1, c.end - c.start);
  }
  return value;
}

// Checks every animated element for snaps (a clip not starting where the last one left the value,
// while the element is visible) and for more than one transform origin.
function checkContinuity(asset: EnvironmentAsset, findings: DesignFinding[]): number {
  const clips = asset.animation?.clips ?? [];
  const slots = perTargetSlots(clips);
  for (const [key, list] of slots) {
    const [target, slot] = key.split("::");
    // Opacity may cut: an element popping in or out is an authored appearance, not a glitch.
    if (slot === "opacity") continue;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (Math.abs(prev.to - cur.from) <= 1e-6) continue;
      // A jump the viewer cannot see is fine: the element is fully transparent on the frame
      // before the jump (it reappears already in place) or on the jump frame itself.
      const opacityClips = slots.get(`${target}::opacity`);
      const opacity = Math.min(valueAt(opacityClips, "opacity", cur.start - 1), valueAt(opacityClips, "opacity", cur.start));
      if (opacity <= 0.001) continue;
      findings.push({
        rule: "continuity",
        severity: "error",
        where: `${asset.assetId} / ${target}`,
        message: `"${cur.clipId}" starts ${slot} at ${cur.from} but "${prev.clipId}" left it at ${prev.to}: a visible snap at frame ${cur.start}. Start from ${prev.to}, or hide the element first.`,
      });
    }
  }
  const origins = new Map<string, { clipId: string; key: string }>();
  for (const clip of clips) {
    if (!clip.origin) continue;
    const key = `${clip.origin.x},${clip.origin.y}`;
    for (const target of clip.targets) {
      const seen = origins.get(target);
      if (seen && seen.key !== key) {
        findings.push({
          rule: "origin",
          severity: "error",
          where: `${asset.assetId} / ${target}`,
          message: `"${clip.clipId}" uses origin (${key}) but "${seen.clipId}" uses (${seen.key}); the compiler applies one origin to every frame, so give the element a single origin.`,
        });
      } else if (!seen) {
        origins.set(target, { clipId: clip.clipId, key });
      }
    }
  }
  return clips.length;
}

// Checks the film's picture is locked to its narration: shot durations, scene length and voiceover agree.
function checkAudioLock(film: Film, findings: DesignFinding[]): void {
  const fps = film.fps ?? FPS;
  const shotFrames = Math.round(film.shots.reduce((sum, s) => sum + s.dur, 0) * fps);
  const scene = film.scene as Scene | undefined;
  if (scene && Math.abs(scene.durationFrames - shotFrames) > 2) {
    findings.push({ rule: "audio-lock", severity: "error", where: "scene", message: `scene runs ${scene.durationFrames} frames but the shots add up to ${shotFrames}; derive both from the measured narration.` });
  }
  // Unnarrated shots at the very end (an editor's closing footage) play after the voice has
  // finished, so they do not unlock anything: the narration is compared with the shots before them.
  let tail = film.shots.length;
  while (tail > 0 && !film.shots[tail - 1].scriptText?.trim()) tail -= 1;
  // A film that records no narration text on any shot has no tail to tell apart.
  if (tail === 0) tail = film.shots.length;
  const tailFrames = Math.round(film.shots.slice(tail).reduce((sum, s) => sum + s.dur, 0) * fps);
  const narratedFrames = shotFrames - tailFrames;
  const vo = film.voiceover?.durationSec;
  if (vo && Math.abs(vo * fps - narratedFrames) > fps) {
    findings.push({ rule: "audio-lock", severity: "error", where: "voiceover", message: `voiceover is ${vo.toFixed(2)}s but the narrated shots last ${(narratedFrames / fps).toFixed(2)}s.` });
  }
  if (vo && tailFrames > 0) {
    findings.push({ rule: "audio-lock", severity: "warning", where: "voiceover", message: `${(tailFrames / fps).toFixed(1)}s of unnarrated shots play after the voiceover ends (${film.shots.slice(tail).map((s) => s.id).join(", ")}).` });
  }
  if (!film.voiceover) {
    findings.push({ rule: "audio-lock", severity: "warning", where: "voiceover", message: "the film has no voiceover yet, so nothing is audio-locked." });
  }
  for (const shot of film.shots) {
    if (!shot.scriptText?.trim()) {
      findings.push({ rule: "audio-lock", severity: "warning", where: `shot ${shot.id}`, message: "carries no narration; every shot should depict what is being said." });
    }
  }
}

// Checks every data device on screen is backed by the shot's own narration. A counter's number
// must actually be spoken (an error: it is a precise claim); whether a chart's kind matches the
// narration is a keyword heuristic, so a mismatch is only a warning worth a look.
function checkHonestData(film: Film, findings: DesignFinding[]): void {
  const devices = ["TokenStrip", "Plot", "MatrixGrid", "Distribution", "LayerStack", "ScaleBar"];
  for (const shot of film.shots) {
    const narration = shot.scriptText ?? "";
    const blocks = shot.blocks as Array<{ c: string; to?: number }>;
    const hasData = blocks.some((b) => b.c === "StatCounter" || devices.includes(b.c));
    if (hasData && !narration.trim()) {
      findings.push({ rule: "honest-data", severity: "warning", where: `shot ${shot.id}`, message: "shows data but carries no narration, so it cannot be checked against what is said." });
      continue;
    }
    for (const block of blocks) {
      if (block.c === "StatCounter") {
        const spoken = numbersIn(narration);
        if (typeof block.to === "number" && !spoken.includes(block.to)) {
          findings.push({
            rule: "honest-data",
            severity: "error",
            where: `shot ${shot.id}`,
            message: `StatCounter shows ${block.to} but the narration ${spoken.length ? `only says ${spoken.join(", ")}` : "states no number"}.`,
          });
        }
      } else if (devices.includes(block.c) && !narrationSupportsVisual(block.c as ShotVisual, narration)) {
        findings.push({ rule: "honest-data", severity: "warning", where: `shot ${shot.id}`, message: `${block.c} may assert data the narration does not talk about; check its labels and values are said.` });
      }
    }
  }
}

// Runs every standard-layer rule over a parsed film manifest.
export function checkFilmDesign(raw: unknown): DesignReport {
  const findings: DesignFinding[] = [];
  const filmId = (raw as { id?: string })?.id ?? "unknown";
  let film: Film;
  try {
    film = parseFilm(raw);
  } catch (err) {
    findings.push({ rule: "schema", severity: "error", where: "film.json", message: err instanceof Error ? err.message.slice(0, 600) : String(err) });
    return { filmId, ok: false, findings, stats: { shots: 0, assets: 0, clips: 0 } };
  }

  let clips = 0;
  const scene = film.scene as Scene | undefined;
  const assets: EnvironmentAsset[] = scene ? [...(scene.background ? [scene.background] : []), ...(scene.props ?? [])] : [];
  if (scene) {
    const result = validateSceneWithNodeAssets(scene);
    for (const e of result.errors) {
      findings.push({ rule: "scene", severity: "error", where: e.entityId ?? "scene", message: e.message });
    }
    for (const asset of assets) {
      checkAsset(asset, film.accent, findings);
      clips += checkContinuity(asset, findings);
    }
  }
  checkAudioLock(film, findings);
  checkHonestData(film, findings);

  return {
    filmId: film.id,
    ok: !findings.some((f) => f.severity === "error"),
    findings,
    stats: { shots: film.shots.length, assets: assets.length, clips },
  };
}

// Loads videos/<id>/film.json and checks it.
export function checkFilmDesignById(filmId: string): DesignReport {
  const file = path.join(REPO_ROOT, "videos", filmId, "film.json");
  if (!fs.existsSync(file)) throw new Error(`no film at videos/${filmId}/film.json`);
  return checkFilmDesign(JSON.parse(fs.readFileSync(file, "utf8")));
}

// Formats a report as plain text an agent or a person can act on.
export function formatDesignReport(report: DesignReport): string {
  const lines = [
    `${report.ok ? "PASS" : "FAIL"} ${report.filmId}: ${report.stats.shots} shots, ${report.stats.assets} assets, ${report.stats.clips} clips`,
  ];
  for (const f of report.findings) lines.push(`  ${f.severity === "error" ? "error" : "warn "} [${f.rule}] ${f.where}: ${f.message}`);
  return lines.join("\n");
}
