/**
 * File Description: Audio-only Remotion entry point for the captain-approved D6 soundtrack golden.
 * Inputs and outputs: Film and format props -> the same Soundtrack component used by studio and delivery.
 * Used by: backend/soundtrack.golden.test.ts.
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { Soundtrack } from "../../src/dl/Soundtrack";
import { buildTimeline } from "../../src/dl/camera";
import { deliveryTimeline, type DeliveryFormat } from "../../src/dl/delivery";
import { parseFilm, type Film } from "../../src/dl/schema";
import base from "../films/fixture-canvas-a.json";

type Props = { film: Film; format: DeliveryFormat };

// Mounts the production audio tree without visual or generated active-film dependencies.
const AudioFilm: React.FC<Props> = ({ film }) => <Soundtrack film={film} timeline={buildTimeline(film)} />;

// Registers a tiny audio-only composition whose timing follows the actual delivery contract.
const Root: React.FC = () => <Composition
  id="Soundtrack"
  component={AudioFilm}
  width={32}
  height={32}
  fps={30}
  durationInFrames={30}
  defaultProps={{ film: parseFilm(base), format: "long" }}
  calculateMetadata={({ props }) => ({
    durationInFrames: deliveryTimeline(props.film, props.format).totalFrames,
    fps: props.film.fps,
    width: props.format === "reel" ? 16 : 32,
    height: props.format === "reel" ? 32 : 16,
  })}
/>;

registerRoot(Root);
