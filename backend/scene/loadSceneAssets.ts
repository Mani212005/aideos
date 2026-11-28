/**
 * File Description: Node-side loader that reads a scene's SVG assets off disk for rendering.
 * SceneView is a pure browser-safe component, so the filesystem half of asset resolution lives
 * here: this module turns a Scene into the svgSources map SceneView renders from, and fails loudly
 * with the asset path in the message when an asset is missing or will not parse.
 * Pictures (raster assets) are checked against their pinned file and given a file:// URL for still renders.
 * Inputs and outputs: asset directory and scene manifest -> loaded and validated SVG asset sources and picture URLs.
 * Used by: backend/nativeRenderer.ts, backend/visionJudge/sampler.ts, test_fixtures/stillTalking/buildFilm.ts and the scene tests.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { EnvironmentAsset, Scene } from "../../src/dl/scene/types";
import { parseSvgDocument } from "../../src/dl/scene/svgDocument";
import { resolveRepoAssetPath } from "../videoPackageLoader";
import { rasterElementIds } from "../../src/dl/scene/raster";
import { rasterFileProblems } from "../pictures/png";

export interface LoadSceneAssetsOptions {
  /**
   * When true a missing or malformed asset throws instead of being skipped.
   * Default true: a scene that renders without its artwork is a broken video, not a warning.
   */
  strict?: boolean;
}

export interface LoadedSceneAssets {
  /** SVG source text keyed by the asset's svgSource path, as SceneView expects. */
  svgSources: Record<string, string>;
  /** Element ids declared by each asset's document, keyed by assetId, for compile validation. */
  elementIdsByAssetId: Record<string, string[]>;
  /** A file:// URL for each picture, keyed by its raster src, as SceneView's `rasterUrls` (still renders). */
  rasterUrls: Record<string, string>;
  /** Assets that could not be loaded, when strict is disabled; `svgSource` names the picture file for a picture. */
  problems: Array<{ assetId: string; svgSource: string; message: string }>;
}

/**
 * Resolves an asset svgSource: absolute, relative to the working directory, or relative to the
 * repo root, with "videos/<id>/..." following AIDEOS_VIDEOS_DIR. The editor dev server runs from
 * editor/, so a cwd-only lookup missed every asset.
 */
function resolveAssetPath(svgSource: string): string {
  return resolveRepoAssetPath(svgSource);
}

/** Reads every environment asset of a scene into the source map and id index SceneView needs. */
export function loadSceneAssets(
  scene: Scene,
  options: LoadSceneAssetsOptions = {},
): LoadedSceneAssets {
  const strict = options.strict !== false;
  const svgSources: Record<string, string> = {};
  const elementIdsByAssetId: Record<string, string[]> = {};
  const rasterUrls: Record<string, string> = {};
  const problems: LoadedSceneAssets["problems"] = [];

  const assets: EnvironmentAsset[] = [];
  if (scene.background) assets.push(scene.background);
  if (Array.isArray(scene.props)) assets.push(...scene.props);

  for (const asset of assets) {
    if (asset.raster) {
      // A picture must be the pinned file at its declared size; a render never shows other bytes.
      const fileProblems = rasterFileProblems(asset.assetId, asset.raster);
      if (fileProblems.length) {
        const message = fileProblems.join("; ");
        if (strict) throw new Error(`SCENE_ASSET_LOAD_FAILED: ${message}`);
        problems.push({ assetId: asset.assetId, svgSource: asset.raster.src, message });
        continue;
      }
      elementIdsByAssetId[asset.assetId] = rasterElementIds(asset);
      rasterUrls[asset.raster.src] = pathToFileURL(resolveAssetPath(asset.raster.src)).href;
      continue;
    }
    if (!asset.svgSource) continue;
    const resolved = resolveAssetPath(asset.svgSource);
    try {
      const content = fs.readFileSync(resolved, "utf8");
      const doc = parseSvgDocument(content);
      svgSources[asset.svgSource] = content;
      const ids: string[] = [];
      const walk = (nodes: typeof doc.children) => {
        for (const node of nodes) {
          if (node.attrs.id) ids.push(node.attrs.id);
          walk(node.children);
        }
      };
      walk(doc.children);
      elementIdsByAssetId[asset.assetId] = ids;
    } catch (err) {
      const message = `Asset "${asset.assetId}" svgSource "${asset.svgSource}" could not be loaded: ${
        err instanceof Error ? err.message : String(err)
      }`;
      if (strict) throw new Error(`SCENE_ASSET_LOAD_FAILED: ${message}`);
      problems.push({ assetId: asset.assetId, svgSource: asset.svgSource, message });
    }
  }

  return { svgSources, elementIdsByAssetId, rasterUrls, problems };
}
