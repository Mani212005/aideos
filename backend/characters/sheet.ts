/**
 * File Description: Renders a character's model sheet, expression sheet and receive stills (wide, reel, phase strip) in headless Chrome.
 * Inputs and outputs: character spec file or id and an output directory -> PNG files plus the hash and retarget report.
 * Used by: `aideos character sheet` and the character journey tests (skipped when no Chrome is installed).
 */
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { parseCharacter, formatIssues } from "../../src/dl/characters/validate";
import { characterHash } from "../../src/dl/characters/hash";
import type { CharacterSpec } from "../../src/dl/characters/schema";
import { fitReceiveSpan } from "../performance/bindReceive";
import type { ReachPolicy } from "../../src/dl/performance/retarget";
import { evaluatePage, SOFTWARE_GL_FLAGS } from "./browser";
import { characterCandidates } from "./library";
import type { SheetImage, SheetRequest } from "./sheetPage";

/** Disk floor below which no sheet is rendered (the project's render policy). */
export const MIN_FREE_BYTES = 3_000_000_000;
/** Contact frame and span the sheet's illustrative receive uses at 30 fps. */
const SHEET_CONTACT = 69, SHEET_FPS = 30;

export interface SheetOptions {
  treatment?: SheetRequest["treatment"];
  outDir?: string;
  placement?: { position: [number, number]; unitsToStage: number };
  policy?: ReachPolicy;
}
export interface SheetResult {
  files: string[];
  hashStatus: string;
  retarget: { ok: boolean; warnings: string[]; error?: string };
}

// Resolves a spec argument that is either a file path or a character id.
export function resolveSpecArgument(arg: string): string {
  if (fs.existsSync(arg)) return path.resolve(arg);
  const found = characterCandidates(arg).find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`no character spec file or library id "${arg}"`);
  return found;
}

// Describes whether a spec's stamped hash matches its content.
function hashStatus(spec: CharacterSpec): string {
  const actual = characterHash(spec);
  if (!spec.hash) return `unstamped (content ${actual.slice(0, 12)})`;
  return spec.hash === actual ? `hash ${actual.slice(0, 12)} verified` : `HASH MISMATCH (stamped ${spec.hash.slice(0, 12)}, content ${actual.slice(0, 12)})`;
}

// Renders all sheets for one spec file into outDir (default .frames/characters/<id>).
export async function renderCharacterSheet(specFile: string, options: SheetOptions = {}): Promise<SheetResult> {
  const raw = JSON.parse(fs.readFileSync(specFile, "utf8"));
  const parsed = parseCharacter(raw);
  if (!parsed.spec || parsed.errors.some((e) => e.path !== "hash")) throw new Error(`cannot draw ${specFile}:\n${formatIssues(parsed.errors.filter((e) => e.path !== "hash"), "  ").join("\n")}`);
  const spec = parsed.spec;
  const outDir = path.resolve(options.outDir ?? path.join(".frames", "characters", spec.id));
  fs.mkdirSync(outDir, { recursive: true });
  const disk = await fs.promises.statfs(outDir);
  if (disk.bavail * disk.bsize < MIN_FREE_BYTES) throw new Error("needs-decision: less than 3 GB free; character sheet not rendered.");
  const retarget: SheetResult["retarget"] = { ok: false, warnings: [] };
  let action: SheetRequest["action"] = null;
  try {
    const fitted = fitReceiveSpan(SHEET_CONTACT, 0, SHEET_CONTACT + 3 * SHEET_FPS, SHEET_FPS, [0, 0, 0], { rig: parsed.rig, policy: options.policy ?? "fail" });
    action = fitted.action;
    retarget.ok = true;
    retarget.warnings = fitted.warnings.map((w) => `${w.field}: ${w.message}`);
  } catch (err) {
    retarget.error = err instanceof Error ? err.message : String(err);
  }
  const pageDir = path.join(outDir, "page");
  fs.mkdirSync(pageDir, { recursive: true });
  await build({ entryPoints: [path.join(__dirname, "sheetPage.ts")], outfile: path.join(pageDir, "sheet.js"), bundle: true, format: "iife", platform: "browser", logLevel: "silent" });
  const request: SheetRequest = { spec, action, ...(options.treatment ? { treatment: options.treatment } : {}), placement: options.placement ?? { position: [940, 1210], unitsToStage: 85 }, hashStatus: hashStatus(spec) };
  const html = path.join(pageDir, "index.html");
  fs.writeFileSync(html, `<!doctype html><html lang="en"><meta charset="utf-8"><title>${spec.name} sheets</title><body><script>window.__sheetRequest=${JSON.stringify(request).replace(/</g, "\\u003c")};</script><script src="sheet.js"></script></body></html>`);
  const { value, errors } = await evaluatePage<SheetImage[]>(html, "window.__sheet", { flags: SOFTWARE_GL_FLAGS });
  if (errors.length) throw new Error(`character sheet page errors:\n${errors.join("\n")}`);
  const files = value.map((img) => {
    const file = path.join(outDir, `${img.name}.png`);
    fs.writeFileSync(file, Buffer.from(img.dataUrl.slice(img.dataUrl.indexOf(",") + 1), "base64"));
    return file;
  });
  return { files, hashStatus: request.hashStatus, retarget };
}
