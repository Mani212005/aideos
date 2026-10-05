/**
 * File Description: Root Remotion entry point registering compositions for Long (16:9), Reel (9:16), and Short (9:16).
 */

import { Composition } from "remotion";
import { Video } from "./dl/Video";
import { defaultFilmProps, filmPropsSchema, FPS, TOTAL_FRAMES } from "./dl/runtime";

// Renders the root Remotion compositions for the film deliverables.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Long"
        component={Video}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
        schema={filmPropsSchema}
        defaultProps={defaultFilmProps}
      />
      <Composition
        id="Reel"
        component={Video}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        schema={filmPropsSchema}
        defaultProps={defaultFilmProps}
      />
      <Composition
        id="Short"
        component={Video}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        schema={filmPropsSchema}
        defaultProps={defaultFilmProps}
      />
      
    </>
  );
};
