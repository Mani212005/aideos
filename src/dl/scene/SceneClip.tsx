/**
 * File Description: Remotion entry point for the Aideos scene graph.
 * Compiles a Scene once and renders the entity state for the current frame, which is what turns a
 * declarative scene plus its custom SVG animation timelines into actual motion inside a
 * composition. Frame-driven throughout: the only time input is Remotion's current frame, so the
 * same scene renders identically on every pass.
 * Inputs and outputs: Scene definition and current frame -> rendered React SVG scene clip.
 * Used by: src/dl/SceneStage.tsx.
 */

import React from "react";
import { useCurrentFrame, useDelayRender } from "remotion";
import type { Scene } from "./types";
import type { CompileOptions, CompiledScene } from "./compile";
import { compileScene } from "./compile";
import { SceneView } from "./SceneView";

export interface SceneClipProps {
  transparentBackground?: boolean;
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

/** Keeps captures behind a completed SVG paint, including cold mounts and frame changes. */
function useSvgPaintReady(frame: number, scene: Scene, width?: number, height?: number): void {
  const { delayRender, continueRender } = useDelayRender();
  const [initial] = React.useState(() => delayRender(`SVG scene ${scene.sceneId} initial paint`));
  React.useLayoutEffect(() => {
    const handle = delayRender(`SVG scene ${scene.sceneId} frame ${frame} painted`);
    // A frame callback runs before paint. The second callback crosses the first paint boundary;
    // DOM commit alone let Chrome capture two raster variants of identical Still Talking SVG.
    let pending = requestAnimationFrame(() => {
      pending = requestAnimationFrame(() => {
        continueRender(handle);
        continueRender(initial);
      });
    });
    return () => {
      cancelAnimationFrame(pending);
      continueRender(handle);
      continueRender(initial);
    };
  }, [frame, scene, width, height, delayRender, continueRender, initial]);
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
  transparentBackground,
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

  useSvgPaintReady(localFrame, scene, width, height);

  return (
    <SceneView
      frame={compiled.frames[localFrame]}
      width={width ?? scene.sceneSize.w}
      height={height ?? scene.sceneSize.h}
      sceneSize={scene.sceneSize}
      accent={accent}
      svgSources={svgSources}
      transparentBackground={transparentBackground}
    />
  );
};
