/**
 * File Description: Renders a film's vector scene as the canvas the whole film plays on.
 * A scene film has no node graph: its stage is a square of scene space, and each output format
 * takes a strip through the middle of that square. Composing once on a square and windowing it per
 * format is what keeps the wide cut and the reel the same film rather than two edits of it, while
 * still giving the reel a genuinely vertical frame instead of a crop of the wide one.
 * Pictures (the illustrated stage's raster assets) load through `staticFile` from the film's package.
 * Inputs and outputs: film.scene, compiled clips, SVG sources, picture URLs, current frame -> one React SVG tree.
 * Used by: src/dl/Film.tsx (Remotion render and the editor Player preview).
 */

import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { SceneClip } from "./scene/SceneClip";
import { SVG_SOURCES } from "./scene/assets/svgSources.generated";
import type { FilmScene } from "./schema";
import { ThreeStage } from "./scene/ThreeStage";
import { stageViewport } from "./scene/projection";
import { validateStageSvgResources } from "./scene/validateStage";

export interface TestStageVisibility { character?: string; prop?: string }

/**
 * The strip each format takes through the square stage, as a fraction of the square's height.
 * A 16:9 frame takes a horizontal band through the centre; a 9:16 frame takes a vertical column.
 * Everything a shot must not lose lives where the two strips overlap, which is the centre square.
 */
export interface SceneStageProps {
  scene: FilmScene;
  /** Composition width in pixels. */
  width: number;
  /** Composition height in pixels. */
  height: number;
  accent?: string;
  testVisibility?: TestStageVisibility;
}

const PINNED_COMPILE_OPTIONS = { clockMs: 0 };

/**
 * The public path a picture is served from: a package file `videos/<slug>/...` as itself, and a committed example
 * `examples/<slug>/...` where the render's public dir links it (`videos/<slug>/...`, backend/pipeline/render.ts).
 */
export function rasterPublicPath(src: string): string {
  return src.replace(/^examples\//, "videos/");
}

/** The staticFile URL of every picture in a scene, keyed by its raster src. */
function sceneRasterUrls(scene: FilmScene): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const asset of [scene.background, ...scene.props]) {
    if (asset?.raster) urls[asset.raster.src] = staticFile(rasterPublicPath(asset.raster.src));
  }
  return urls;
}

/** Draws the scene square centred in the frame, clipped to whatever the format can show of it. */
export const SceneStage: React.FC<SceneStageProps> = ({ scene, width, height, accent, testVisibility }) => {
  // Cover, never contain: the scene is drawn large enough that the frame is always full, and the
  // frame is a window centred on it. Letterboxing a scene would put the design language's one
  // forbidden thing on screen, a black bar, and would waste the vertical room a reel exists for.
  const fit = stageViewport(width, height, scene.sceneSize).fit;
  const drawnWidth = scene.sceneSize.w * fit;
  const drawnHeight = scene.sceneSize.h * fit;

  // SVG has explicit ground and foreground planes; cast shares one WebGL depth buffer between them.
  const three = scene.renderer === "three";
  const missing = validateStageSvgResources(scene, SVG_SOURCES);
  const rasterUrls = React.useMemo(() => sceneRasterUrls(scene), [scene]);
  if (missing.length) throw new Error(missing.join("\n"));
  const ground = three ? { ...scene, props: scene.props.filter((p) => p.plane === "background") } : scene;
  const foreground = three ? { ...scene, background: { ...scene.background, opacity: 0 }, props: scene.props.filter((p) => p.plane === "foreground") } : null;
  // Draws one SVG plane using the established square-stage cover transform.
  const plane = (data: FilmScene, transparentBackground = false) => (
    <div style={{ position: "absolute", left: (width - drawnWidth) / 2, top: (height - drawnHeight) / 2, width: drawnWidth, height: drawnHeight }}>
      <SceneClip scene={data} svgSources={SVG_SOURCES} rasterUrls={rasterUrls} width={drawnWidth} height={drawnHeight} viewport={{ width, height }} accent={accent} compileOptions={PINNED_COMPILE_OPTIONS} transparentBackground={transparentBackground} />
    </div>
  );
  if (three) return <AbsoluteFill style={{ overflow: "hidden" }}>
    {plane(ground)}
    <ThreeStage scene={scene} width={width} height={height} testVisibility={testVisibility} />
    {foreground?.props.length ? plane(foreground, true) : null}
  </AbsoluteFill>;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: (width - drawnWidth) / 2,
          top: (height - drawnHeight) / 2,
          width: drawnWidth,
          height: drawnHeight,
        }}
      >
        <SceneClip
          scene={scene}
          svgSources={SVG_SOURCES}
          rasterUrls={rasterUrls}
          width={drawnWidth}
          height={drawnHeight}
          viewport={{ width, height }}
          accent={accent}
          compileOptions={PINNED_COMPILE_OPTIONS}
        />
      </div>
    </AbsoluteFill>
  );
};
