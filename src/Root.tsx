import "./index.css";
import { Composition, Folder } from "remotion";
import { EpisodeVideo } from "./Video";
import { FPS, TOTAL_FRAMES } from "./script";
import { defaultVideoProps, videoPropsSchema } from "./videoProps";
import { MyComposition } from "./legacy/Composition";
import { MachineryTest } from "./legacy/MachineryTest";
import { FinalStory } from "./legacy/FinalStory";
import { DLVideo } from "./dl/DLVideo";
import { defaultDLProps, dlPropsSchema, DL_FPS, DL_TOTAL_FRAMES } from "./dl/runtime";

/**
 * One component, three deliverables. Aspect ratio is not a variant of the video —
 * the layout system reads it from `useVideoConfig()` and re-composes, so the same
 * script produces a YouTube cut, a Reels/Shorts cut and a feed cut.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/*
        The design-language engine. One canvas, one camera, ten devices — the
        two entries below are the same film, not two edits of it: `Reel` is a
        narrower camera on the same canvas, solved from the same shot list.
      */}
      <Folder name="DL">
        <Composition
          id="DL-Long"
          component={DLVideo}
          durationInFrames={DL_TOTAL_FRAMES}
          fps={DL_FPS}
          width={1920}
          height={1080}
          schema={dlPropsSchema}
          defaultProps={defaultDLProps}
        />
        <Composition
          id="DL-Reel"
          component={DLVideo}
          durationInFrames={DL_TOTAL_FRAMES}
          fps={DL_FPS}
          width={1080}
          height={1920}
          schema={dlPropsSchema}
          defaultProps={defaultDLProps}
        />
      </Folder>

      <Folder name="Video">
        <Composition
          id="Video-Landscape"
          component={EpisodeVideo}
          durationInFrames={TOTAL_FRAMES}
          fps={FPS}
          width={1920}
          height={1080}
          schema={videoPropsSchema}
          defaultProps={defaultVideoProps}
        />
        <Composition
          id="Video-Portrait"
          component={EpisodeVideo}
          durationInFrames={TOTAL_FRAMES}
          fps={FPS}
          width={1080}
          height={1920}
          schema={videoPropsSchema}
          defaultProps={defaultVideoProps}
        />
        <Composition
          id="Video-Square"
          component={EpisodeVideo}
          durationInFrames={TOTAL_FRAMES}
          fps={FPS}
          width={1080}
          height={1080}
          schema={videoPropsSchema}
          defaultProps={defaultVideoProps}
        />
      </Folder>

      {/* Kept for before/after comparison in Studio. */}
      <Folder name="Legacy">
        <MyComposition />
        <Composition
          id="Legacy-MachineryTest"
          component={MachineryTest}
          durationInFrames={300}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Legacy-FinalStory"
          component={FinalStory}
          durationInFrames={1500}
          fps={30}
          width={1920}
          height={1080}
        />
      </Folder>
    </>
  );
};
