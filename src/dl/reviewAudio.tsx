/**
 * File Description: Audio-only composition for measuring production narration and music stems through the shared mixer.
 * Inputs and outputs: Film, format and stem props -> frame-exact isolated soundtrack audio.
 * Used by: backend/review/music.ts.
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { Soundtrack } from "./Soundtrack";
import { buildTimeline } from "./camera";
import { deliveryTimeline, type DeliveryFormat } from "./delivery";
import type { Film } from "./schema";

type Props = { film: Film | null; format: DeliveryFormat; stem: "music" | "narration" };

// Mounts precisely the same audio tree as the delivered film with one isolated bus.
const Stem: React.FC<Props> = ({ film, stem }) => {
  if (!film) throw new Error("Review audio requires a film");
  return <Soundtrack film={film} timeline={buildTimeline(film)} stem={stem} />;
};

// Registers audio-only metadata without importing the generated active film or any visual engine.
const Root: React.FC = () => <Composition
  id="ReviewAudio" component={Stem} width={32} height={16} fps={30} durationInFrames={30}
  defaultProps={{ film: null, format: "long", stem: "music" }}
  calculateMetadata={({ props }) => {
    if (!props.film) throw new Error("Review audio requires a film");
    return {
      durationInFrames: deliveryTimeline(props.film, props.format).totalFrames,
      fps: props.film.fps,
      width: props.format === "reel" ? 16 : 32,
      height: props.format === "reel" ? 32 : 16,
    };
  }}
/>;

registerRoot(Root);
