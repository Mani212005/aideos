/**
 * File Description: Root Remotion entry point registering compositions for Long (16:9), Reel (9:16), Short (9:16), and standalone 3D shader clusters.
 */

import { Composition } from "remotion";
import { Video } from "./dl/Video";
import { defaultFilmProps, filmPropsSchema, FPS, TOTAL_FRAMES } from "./dl/runtime";
import { GlowingClusterMetaphor } from "./dl/metaphors/GlowingClusterMetaphor";

// Renders the root Remotion compositions for the film deliverables and 3D metaphors.
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
      <Composition
        id="GlowingCluster3D"
        component={GlowingClusterMetaphor}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          width: 1920,
          height: 1080,
          title: 'HIGH-FIDELITY SHADER CLUSTER',
          subtitle: 'Deterministic 3D Rendering Engine',
        }}
      />
    </>
  );
};
