import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { StoryVideo } from "./Story";
import React from "react";

type Props = {};

const calculateMetadata: CalculateMetadataFunction<Props> = () => {
  return {};
};

const FPS = 30;
const totalDuration = 1590; // 53 seconds * 30 fps

export const MyComposition = () => {
  return (
    <>
      <Composition
        id="MyComp-Landscape"
        component={StoryVideoWithAudio}
        durationInFrames={totalDuration}
        fps={FPS}
        width={1920}
        height={1080}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="MyComp-Portrait"
        component={StoryVideoWithAudio}
        durationInFrames={totalDuration}
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="MyComp-Square"
        component={StoryVideoWithAudio}
        durationInFrames={totalDuration}
        fps={FPS}
        width={1080}
        height={1080}
        calculateMetadata={calculateMetadata}
      />
    </>
  );
};

export const StoryVideoWithAudio: React.FC<Props> = () => {
  return (
    <>
      {/* Lowered volume to 0.15 (quieter) and using the new upbeat track */}
      <Audio src={staticFile("audio.mp3")} volume={0.15} from={-50} />
      <StoryVideo />
    </>
  );
};
