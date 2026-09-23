/**
 * File Description: Node-runtime asset verifier for Aideos Scene Graphs.
 * Extends the pure validateScene validator with filesystem checks the pure layer cannot make:
 * that every asset's SVG exists and parses, and that every element id referenced by a rotating
 * sub-group (D1) or by a custom animation clip is actually declared in that SVG document.
 */

import fs from "fs";
import path from "path";
import { validateScene as pureValidateScene, type ValidationResult } from "./validateScene";
import type { EnvironmentAsset, Scene } from "./types";
import { collectSvgElementIds, parseSvgDocument } from "./svgDocument";

/** The repo root: asset svgSource paths ("videos/<id>/visuals/x.svg") are relative to it. */
const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * Resolves an asset svgSource: absolute, relative to the working directory, or relative to the
 * repo root. The editor dev server runs from editor/, so a cwd-only lookup missed every asset.
 */
function resolveAssetPath(svgSource: string): string {
  if (path.isAbsolute(svgSource)) return svgSource;
  const fromCwd = path.resolve(process.cwd(), svgSource);
  return fs.existsSync(fromCwd) ? fromCwd : path.resolve(REPO_ROOT, svgSource);
}

/** Reads an asset's SVG off disk and returns the element ids it declares, or null if unreadable. */
export function readAssetElementIds(svgSource: string): string[] | null {
  try {
    const content = fs.readFileSync(resolveAssetPath(svgSource), "utf8");
    return collectSvgElementIds(parseSvgDocument(content));
  } catch {
    return null;
  }
}

/**
 * Collects, for every asset in a scene whose SVG is readable, the element ids it declares.
 * Feed the result to compileScene's assetElementIds option so dangling animation targets fail.
 */
export function collectSceneAssetElementIds(scene: Scene): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const assets: EnvironmentAsset[] = [];
  if (scene.background) assets.push(scene.background);
  if (Array.isArray(scene.props)) assets.push(...scene.props);

  for (const asset of assets) {
    if (!asset.svgSource) continue;
    const ids = readAssetElementIds(asset.svgSource);
    if (ids) out[asset.assetId] = ids;
  }
  return out;
}

/** Validates a scene including every filesystem-backed check the pure validator cannot make. */
export function validateSceneWithNodeAssets(sceneInput: Scene): ValidationResult {
  const result = pureValidateScene(sceneInput);

  const assets: EnvironmentAsset[] = [];
  if (sceneInput.background) assets.push(sceneInput.background);
  if (Array.isArray(sceneInput.props)) assets.push(...sceneInput.props);

  for (const asset of assets) {
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
