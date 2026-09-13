/**
 * File Description: Remotion entry point for the Aideos scene graph.
 * Compiles a Scene once and renders the entity state for the current frame, which is what turns a
 * declarative scene plus its custom SVG animation timelines into actual motion inside a
 * composition. Frame-driven throughout: the only time input is Remotion's current frame, so the
 * same scene renders identically on every pass.
 */

import React from "react";
import { useCurrentFrame } from "remotion";
import type { Scene } from "./types";
import type { CompileOptions, CompiledScene } from "./compile";
import { compileScene } from "./compile";
import { SceneView } from "./SceneView";

export interface SceneClipProps {
  scene: Scene;
  /** SVG source text per asset svgSource path. Without it, assets fall back to placeholders. */
  svgSources?: Record<string, string>;
  /** Composition frame that scene frame 0 lands on. Defaults to 0. */
  startFrame?: number;
  /** Output size in pixels. Defaults to the scene's own coordinate space. */
  width?: number;
  height?: number;
  accent?: string;
  compileOptions?: CompileOptions;
  /** Called once per compile with the compiled scene, for callers that want its warnings. */
  onCompiled?: (compiled: CompiledScene) => void;
}

/** Safely reads Remotion's current frame, falling back to 0 outside a composition. */
function useSafeCurrentFrame(): number {
  try {
    return useCurrentFrame();
  } catch {
    return 0;
  }
}

/**
 * Renders a Scene inside a Remotion composition, holding the last frame past the scene's end.
 * Holding rather than blanking keeps a shot on screen while its narration finishes, which is the
 * continuity the design language asks for: things stay and evolve, they do not cut to nothing.
 */
export const SceneClip: React.FC<SceneClipProps> = ({
  scene,
  svgSources,
  startFrame = 0,
  width,
  height,
  accent,
  compileOptions,
  onCompiled,
}) => {
  const frame = useSafeCurrentFrame();

  const compiled = React.useMemo(() => {
    const result = compileScene(scene, compileOptions ?? {});
    onCompiled?.(result);
    return result;
    // onCompiled is a reporting callback; recompiling because its identity changed would be waste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, compileOptions]);

  const localFrame = Math.min(
    compiled.durationFrames - 1,
    Math.max(0, frame - startFrame),
  );

  return (
    <SceneView
      frame={compiled.frames[localFrame]}
      width={width ?? scene.sceneSize.w}
      height={height ?? scene.sceneSize.h}
      sceneSize={scene.sceneSize}
      accent={accent}
      svgSources={svgSources}
    />
  );
};
