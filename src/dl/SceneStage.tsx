/**
 * File Description: Renders a film's vector scene as the canvas the whole film plays on.
 * A scene film has no node graph: its stage is a square of scene space, and each output format
 * takes a strip through the middle of that square. Composing once on a square and windowing it per
 * format is what keeps the wide cut and the reel the same film rather than two edits of it, while
 * still giving the reel a genuinely vertical frame instead of a crop of the wide one.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import { SceneClip } from "./scene/SceneClip";
import { SVG_SOURCES } from "./scene/assets/svgSources.generated";
import type { Scene } from "./scene/types";
import type { FilmScene } from "./schema";

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
}

const PINNED_COMPILE_OPTIONS = { clockMs: 0 };

/** Draws the scene square centred in the frame, clipped to whatever the format can show of it. */
export const SceneStage: React.FC<SceneStageProps> = ({ scene, width, height, accent }) => {
  // Cover, never contain: the scene is drawn large enough that the frame is always full, and the
  // frame is a window centred on it. Letterboxing a scene would put the design language's one
  // forbidden thing on screen, a black bar, and would waste the vertical room a reel exists for.
  const fit = Math.max(width / scene.sceneSize.w, height / scene.sceneSize.h);
  const drawnWidth = scene.sceneSize.w * fit;
  const drawnHeight = scene.sceneSize.h * fit;

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
          scene={scene as unknown as Scene}
          svgSources={SVG_SOURCES}
          width={drawnWidth}
          height={drawnHeight}
          accent={accent}
          compileOptions={PINNED_COMPILE_OPTIONS}
        />
      </div>
    </AbsoluteFill>
  );
};
