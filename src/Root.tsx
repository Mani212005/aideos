import { Composition } from "remotion";
import { Video } from "./dl/Video";
import { defaultFilmProps, filmPropsSchema, FPS, TOTAL_FRAMES } from "./dl/runtime";
import { GlowingClusterMetaphor } from "./dl/metaphors/GlowingClusterMetaphor";

/**
 * Two deliverables, one film.
 *
 * `Reel` is not a second edit of `Long`. Both solve their framing from the same
 * canvas and the same shot list — the camera simply has a narrower viewport to
 * fit into, so every shot re-frames itself. There is no per-format authoring
 * anywhere in the project, which is why a third aspect ratio would be another
 * entry here rather than another script.
 */
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
        durationInFrames={2700}
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
