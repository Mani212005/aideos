/**
 * File Description: The `aideos pictures` commands of the illustrated stage. `status` lists every picture a film's design declares with its fingerprint and whether its image is cached, pinned (approved) or still to make, and prints the exact prompt for each one still to make. `add` stores a PNG made elsewhere (on the captain's Mac through Codex image generation) under the fingerprint of its current prompt, byte for byte with its provenance data, writes its record, and with `--pin` pins its sha256 in design.json (the approval). Nothing here generates an image or calls an image service.
 * Inputs and outputs: a film id, a picture id and a PNG file -> the cache entry and record, an optional pin, and a status table on stdout.
 * Used by: backend/cli.ts (registerPictureCommands), bin/aideos (`aideos pictures status|add`).
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { designSpecSchema } from "../designSpec/spec";
import { pictureFingerprint, pictureFiles, readCachedPicture, requestFor, storePicture, type DeclaredPictures } from "./cache";
import { composePicturePrompt, promptProblems } from "./policy";

/** Reads a film's design.json and its `pictures` block, or throws naming what is missing. */
function readDeclaredPictures(film: string): { pkg: string; designFile: string; raw: Record<string, unknown>; pictures: DeclaredPictures } {
  const pkg = resolvePackageDir(film);
  const designFile = path.join(pkg, "design", "design.json");
  if (!fs.existsSync(designFile)) throw new Error(`no design at videos/${film}/design/design.json`);
  const raw = JSON.parse(fs.readFileSync(designFile, "utf8")) as Record<string, unknown>;
  const parsed = designSpecSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`design.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (!("pictures" in parsed.data) || !parsed.data.pictures) throw new Error(`design.json of ${film} declares no pictures`);
  return { pkg, designFile, raw, pictures: parsed.data.pictures };
}

/** One line per declared picture: id, fingerprint and state, plus the prompt of each one still to make. */
export function pictureStatusLines(film: string): string[] {
  const { pkg, pictures } = readDeclaredPictures(film);
  const lines: string[] = [];
  for (const problem of promptProblems(pictures.style)) lines.push(`style paragraph ${problem}`);
  for (const item of pictures.items) {
    const request = requestFor(pictures, item);
    const fingerprint = pictureFingerprint(request);
    const cached = readCachedPicture(pkg, request);
    const state = !cached ? "to make" : !item.sha256 ? "cached, not pinned" : item.sha256 === cached.record.sha256 ? "pinned" : "cached, pin differs";
    lines.push(`${item.id.padEnd(16)} ${fingerprint} ${item.aspect.padEnd(5)} ${state}`);
    for (const problem of promptProblems(item.prompt)) lines.push(`  prompt ${problem}`);
    if (!cached) lines.push(...composePicturePrompt(pictures.style, item.prompt).split("\n").map((line) => `  | ${line}`));
  }
  return lines;
}

/** Stores a PNG made elsewhere as the picture `pictureId` of a film, and pins it when asked; returns what it did. */
export function addPicture(film: string, pictureId: string, file: string, options: { seconds: number; pin?: boolean }): string {
  const { pkg, designFile, raw, pictures } = readDeclaredPictures(film);
  const item = pictures.items.find((i) => i.id === pictureId);
  if (!item) throw new Error(`design.json declares no picture "${pictureId}" (pictures: ${pictures.items.map((i) => i.id).join(", ")})`);
  const record = storePicture(pkg, requestFor(pictures, item), fs.readFileSync(file), { seconds: options.seconds });
  const out = [`stored ${pictureId} as videos/${film}/${pictureFiles(record.fingerprint).png} (${record.width} x ${record.height}, sha256 ${record.sha256})`];
  if (options.pin) {
    const items = ((raw.pictures as { items: Array<Record<string, unknown>> }).items);
    const entry = items.find((i) => i.id === pictureId)!;
    entry.sha256 = record.sha256;
    fs.writeFileSync(designFile, `${JSON.stringify(raw, null, 2)}\n`);
    out.push(`pinned ${pictureId} in design.json`);
  } else {
    out.push(`look at it, then pin it in design.json: "sha256": "${record.sha256}" (or rerun with --pin)`);
  }
  return out.join("\n");
}

/** Registers `pictures-status` and `pictures-add` on the backend CLI. */
export function registerPictureCommands(program: Command): void {
  program
    .command("pictures-status")
    .description("List a film's declared pictures: fingerprint, and whether each is cached, pinned or still to make (with its prompt)")
    .argument("<film>", "film id under videos/")
    .action((film: string) => {
      console.log(pictureStatusLines(film).join("\n"));
    });
  program
    .command("pictures-add")
    .description("Store a PNG made elsewhere as one of a film's declared pictures, byte for byte, with its record")
    .argument("<film>", "film id under videos/")
    .argument("<picture>", "the picture id in design.json pictures.items")
    .argument("<file>", "the PNG file, exactly as the generator returned it")
    .requiredOption("--seconds <s>", "how long the generation took, in seconds")
    .option("--pin", "also pin its sha256 in design.json (approve it)")
    .action((film: string, picture: string, file: string, options: { seconds: string; pin?: boolean }) => {
      const seconds = Number(options.seconds);
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`--seconds must be a non-negative number, got ${options.seconds}`);
      console.log(addPicture(film, picture, file, { seconds, pin: options.pin }));
    });
}
