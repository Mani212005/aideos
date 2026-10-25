/**
 * File Description: Root Remotion entry point registering the two deliverables, Long (16:9) and Reel (9:16), each as long as its story plus its end card.
 * Inputs and outputs: Remotion composition props and schema -> Remotion Root with Long and Reel compositions.
 * Used by: src/index.ts (Remotion root entry point).
 */

import { Composition } from "remotion";
import { Video, ReelVideo } from "./dl/Video";
import { defaultFilmProps, defaultReelProps, filmPropsSchema, FPS, LONG_TOTAL_FRAMES, REEL_TOTAL_FRAMES } from "./dl/runtime";

// Renders the root Remotion compositions for the film deliverables.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Long"
        component={Video}
        durationInFrames={LONG_TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
        schema={filmPropsSchema}
        defaultProps={defaultFilmProps}
      />
      <Composition
        id="Reel"
        component={ReelVideo}
        durationInFrames={REEL_TOTAL_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        schema={filmPropsSchema}
        defaultProps={defaultReelProps}
      />
    </>
  );
};
