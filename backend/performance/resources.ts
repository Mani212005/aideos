/**
 * File Description: Validates the frozen stage resource bytes on disk before build, review or export.
 * Inputs and outputs: optional resource reader -> hash/missing-resource diagnostics.
 * Used by: Node scene validation and pipeline cache fingerprints.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import { DOT_RESOURCES, DOT_RESOURCE_HASH, STAGE_RESOURCES, APPROVED_REFERENCES, STAGE_RESOURCE_HASH, CEL_TREATMENT } from "../../src/dl/scene/rigs/registry";

// Verifies approved rig, art and adapter resources, exposing missing files as failures instead of SVG evidence.
export function validateStageResources(read: (file: string) => Uint8Array = (file) => fs.readFileSync(resolveRepoAssetPath(file)), dots = false): string[] {
  const errors = Object.entries({ ...STAGE_RESOURCES, ...APPROVED_REFERENCES, ...(dots ? DOT_RESOURCES : {}) }).flatMap(([file, expected]) => {
    try { return crypto.createHash("sha256").update(read(file)).digest("hex") === expected ? [] : [`stage resource ${file}: hash differs from frozen version`]; }
    catch { return [`stage resource ${file}: missing or unreadable`]; }
  });
  if (crypto.createHash("sha256").update(JSON.stringify({ resources: STAGE_RESOURCES, treatment: CEL_TREATMENT })).digest("hex") !== STAGE_RESOURCE_HASH) errors.push("stage identity: treatment or resource manifest hash differs from frozen version");
  if (dots && crypto.createHash("sha256").update(JSON.stringify(DOT_RESOURCES)).digest("hex") !== DOT_RESOURCE_HASH) errors.push("dots identity: resource manifest hash differs from frozen version");
  return errors;
}
