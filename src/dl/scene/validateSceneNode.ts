/**
 * File Description: Node-runtime asset verifier for Aideos Scene Graphs.
 * Extends the pure validateScene validator with filesystem SVG asset existence and element ID checks.
 */

import fs from "fs";
import path from "path";
import { validateScene as pureValidateScene, type ValidationResult } from "./validateScene";
import type { Scene } from "./types";

export function validateSceneWithNodeAssets(sceneInput: Scene): ValidationResult {
  const result = pureValidateScene(sceneInput);

  if (sceneInput.background) {
    const asset = sceneInput.background;
    if (asset.svgSource) {
      const resolvedPath = path.isAbsolute(asset.svgSource)
        ? asset.svgSource
        : path.resolve(process.cwd(), asset.svgSource);

      if (!fs.existsSync(resolvedPath)) {
        result.isValid = false;
        result.errors.push({
          rule: 11,
          entityId: asset.assetId,
          message: `Asset "${asset.assetId}" svgSource file not found on disk: "${asset.svgSource}"`,
        });
      }
    }
  }

  if (sceneInput.props) {
    for (const prop of sceneInput.props) {
      if (prop.svgSource) {
        const resolvedPath = path.isAbsolute(prop.svgSource)
          ? prop.svgSource
          : path.resolve(process.cwd(), prop.svgSource);

        if (!fs.existsSync(resolvedPath)) {
          result.isValid = false;
          result.errors.push({
            rule: 11,
            entityId: prop.assetId,
            message: `Asset "${prop.assetId}" svgSource file not found on disk: "${prop.svgSource}"`,
          });
        } else if (prop.subGroups && prop.subGroups.length > 0) {
          try {
            const content = fs.readFileSync(resolvedPath, "utf8");
            for (const sub of prop.subGroups) {
              if (sub.elementId && !content.includes(`id="${sub.elementId}"`)) {
                result.isValid = false;
                result.errors.push({
                  rule: 16,
                  entityId: prop.assetId,
                  message: `RotatingSubGroup elementId "${sub.elementId}" not found in SVG source "${prop.svgSource}"`,
                });
              }
            }
          } catch {
            // Read error
          }
        }
      }
    }
  }

  return result;
}
