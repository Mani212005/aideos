/**
 * File Description: Node-runtime asset verifier for Aideos Scene Graphs.
 * Extends the pure validateScene validator with filesystem checks the pure layer cannot make:
 * that every asset's SVG exists and parses, that every picture's PNG exists, decodes at its declared size and
 * still has its pinned sha256, and that every element id referenced by a rotating
 * sub-group (D1) or by a custom animation clip is actually declared in that SVG document.
 * Inputs and outputs: Scene data and asset directory -> filesystem existence checks and asset validation.
 * Used by: backend/designCheck/designCheck.ts, test_fixtures/stillTalking/buildFilm.ts, backend/scene/scene.test.ts.
 */

import fs from "fs";
import { validateScene as pureValidateScene, type ValidationResult } from "../../src/dl/scene/validateScene";
import type { EnvironmentAsset, Scene } from "../../src/dl/scene/types";
import { collectSvgElementIds, parseSvgDocument } from "../../src/dl/scene/svgDocument";
import { resolveRepoAssetPath } from "../videoPackageLoader";
import { validateStageResources } from "../performance/resources";
import { rasterFileProblems } from "../pictures/png";

/**
 * Resolves an asset svgSource: absolute, relative to the working directory, or relative to the
 * repo root, with "videos/<id>/..." following AIDEOS_VIDEOS_DIR. The editor dev server runs from
 * editor/, so a cwd-only lookup missed every asset.
 */
function resolveAssetPath(svgSource: string): string {
  return resolveRepoAssetPath(svgSource);
}

/** Validates a scene including every filesystem-backed check the pure validator cannot make. */
export function validateSceneWithNodeAssets(sceneInput: Scene): ValidationResult {
  const result = pureValidateScene(sceneInput);
  if (sceneInput.renderer === "three") {
    result.errors.push(...validateStageResources(undefined, sceneInput.treatment === "dots-v1" || Boolean(sceneInput.treatments?.some((span) => span.treatment === "dots-v1")) || Boolean(sceneInput.cast?.some((cast) => cast.treatment === "dots-v1"))).map((message) => ({ rule: 22, message })));
    result.isValid = result.errors.length === 0;
  }

  const assets: EnvironmentAsset[] = [];
  if (sceneInput.background) assets.push(sceneInput.background);
  if (Array.isArray(sceneInput.props)) assets.push(...sceneInput.props);

  for (const asset of assets) {
    if (asset.raster) {
      for (const message of rasterFileProblems(asset.assetId, asset.raster)) {
        result.isValid = false;
        result.errors.push({ rule: 11, entityId: asset.assetId, message });
      }
      continue;
    }
    if (!asset.svgSource) continue;
    const resolvedPath = resolveAssetPath(asset.svgSource);

    if (!fs.existsSync(resolvedPath)) {
      result.isValid = false;
      result.errors.push({
        rule: 11,
        entityId: asset.assetId,
        message: `Asset "${asset.assetId}" svgSource file not found on disk: "${asset.svgSource}"`,
      });
      continue;
    }

    // Parse once and reuse: a malformed asset must fail here rather than at render time.
    let declaredIds: string[];
    try {
      declaredIds = collectSvgElementIds(parseSvgDocument(fs.readFileSync(resolvedPath, "utf8")));
    } catch (err) {
      result.isValid = false;
      result.errors.push({
        rule: 11,
        entityId: asset.assetId,
        message: `Asset "${asset.assetId}" svgSource "${asset.svgSource}" is not parseable SVG: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }

    const declared = new Set(declaredIds);

    // Rule 16: every D1 rotating sub-group must name an element that exists in the document.
    for (const sub of asset.subGroups ?? []) {
      if (sub.elementId && !declared.has(sub.elementId)) {
        result.isValid = false;
        result.errors.push({
          rule: 16,
          entityId: asset.assetId,
          message: `RotatingSubGroup elementId "${sub.elementId}" not found in SVG source "${asset.svgSource}"`,
        });
      }
    }

    // Rule 20: every custom animation clip must target an element that exists in the document.
    for (const clip of asset.animation?.clips ?? []) {
      for (const target of clip.targets ?? []) {
        if (!declared.has(target)) {
          result.isValid = false;
          result.errors.push({
            rule: 20,
            entityId: asset.assetId,
            message: `Animation clip "${clip.clipId}" targets element id "${target}", which is not declared in SVG source "${asset.svgSource}". Declared ids: [${declaredIds.join(", ")}]`,
          });
        }
      }
    }
  }

  return result;
}
