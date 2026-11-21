/**
 * File Description: Remotion entry point for the Aideos scene graph.
 * Compiles a Scene once and renders the entity state for the current frame, which is what turns a
 * declarative scene plus its custom SVG animation timelines into actual motion inside a
 * composition. Frame-driven throughout: the only time input is Remotion's current frame, so the
 * same scene renders identically on every pass.
 * Pictures (raster assets) are fetched and decoded before any frame is captured, so a frame never shows one half loaded.
 * Inputs and outputs: Scene definition, SVG sources, picture URLs and current frame -> rendered React SVG scene clip.
 * Used by: src/dl/SceneStage.tsx.
 */

import React from "react";
import { useCurrentFrame, useDelayRender } from "remotion";
import type { Scene } from "./types";
import type { CompileOptions, CompiledScene } from "./compile";
import { compileScene } from "./compile";
import { SceneView } from "./SceneView";
import { adjustStageCameraForFormat } from "../fullScreenHeroLayout";

export interface SceneClipProps {
  transparentBackground?: boolean;
  scene: Scene;
  /** SVG source text per asset svgSource path. Without it, assets fall back to placeholders. */
  svgSources?: Record<string, string>;
  /** The URL each picture loads from, keyed by its raster src; every one is decoded before a frame is captured. */
  rasterUrls?: Record<string, string>;
  /** Composition frame that scene frame 0 lands on. Defaults to 0. */
  startFrame?: number;
  /** Output size in pixels. Defaults to the scene's own coordinate space. */
  width?: number;
  height?: number;
  /** Composition viewport size, so 9:16 reels shift the stage camera clear of the reel caption safe zone. */
  viewport?: { width: number; height: number };
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
  const initialReleased = React.useRef(false);
  React.useLayoutEffect(() => {
    const handle = delayRender(`SVG scene ${scene.sceneId} frame ${frame} painted`);
    // Frame callbacks run before paint. Crossing paint boundaries plus a macrotask timer
    // ensures Chromium's compositor finishes rasterizing SVG before Remotion captures.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = requestAnimationFrame(() => {
      pending = requestAnimationFrame(() => {
        timer = setTimeout(() => {
          continueRender(handle);
          if (!initialReleased.current) {
            initialReleased.current = true;
            continueRender(initial);
          }
        }, 50);
      });
    });
    return () => {
      cancelAnimationFrame(pending);
      if (timer !== undefined) clearTimeout(timer);
      continueRender(handle);
      if (!initialReleased.current) {
        initialReleased.current = true;
        continueRender(initial);
      }
    };
  }, [frame, scene, width, height, delayRender, continueRender, initial]);
}

/** Decoded picture URLs of this page, so each picture is fetched and decoded once however many frames draw it. */
const decodedRasters = new Map<string, Promise<void>>();

/** Fetches and decodes one picture URL once per page; a picture that cannot load rejects with its URL named. */
function decodeRaster(url: string): Promise<void> {
  let pending = decodedRasters.get(url);
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        image.decode().then(resolve, () => resolve());
      };
      image.onerror = () => reject(new Error(`the picture ${url} could not be loaded`));
      image.src = url;
    });
    decodedRasters.set(url, pending);
  }
  return pending;
}

/** Holds the render until every picture of the scene is decoded, so no frame is captured with a picture missing. */
function useRastersReady(rasterUrls: Record<string, string> | undefined): void {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const urls = React.useMemo(() => Object.values(rasterUrls ?? {}).sort(), [rasterUrls]);
  const key = urls.join("\n");
  React.useLayoutEffect(() => {
    if (urls.length === 0 || typeof Image === "undefined") return;
    const handle = delayRender(`scene pictures decoded (${urls.length})`);
    let released = false;
    Promise.all(urls.map(decodeRaster)).then(
      () => {
        released = true;
        continueRender(handle);
      },
      (err: unknown) => {
        released = true;
        cancelRender(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      if (!released) continueRender(handle);
    };
    // `key` stands for the URL list, so an equal set of pictures does not restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayRender, continueRender, cancelRender]);
}

/**
 * Renders a Scene inside a Remotion composition, holding the last frame past the scene's end.
 * Holding rather than blanking keeps a shot on screen while its narration finishes, which is the
 * continuity the design language asks for: things stay and evolve, they do not cut to nothing.
 */
export const SceneClip: React.FC<SceneClipProps> = ({
  scene,
  svgSources,
  rasterUrls,
  startFrame = 0,
  width,
  height,
  viewport,
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

  useRastersReady(rasterUrls);
  useSvgPaintReady(localFrame, scene, width, height);

  const rawFrame = compiled.frames[localFrame];
  const displayFrame =
    viewport && rawFrame.camera
      ? {
          ...rawFrame,
          camera: adjustStageCameraForFormat(rawFrame.camera, viewport.width, viewport.height, scene.sceneSize),
        }
      : rawFrame;

  return (
    <SceneView
      frame={displayFrame}
      width={width ?? scene.sceneSize.w}
      height={height ?? scene.sceneSize.h}
      sceneSize={scene.sceneSize}
      accent={accent}
      svgSources={svgSources}
      rasterUrls={rasterUrls}
      transparentBackground={transparentBackground}
    />
  );
};
