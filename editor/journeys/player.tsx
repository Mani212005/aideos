/**
 * File Description: Mounts the editor's FilmView inside a real Remotion Player at native composition size.
 * Inputs and outputs: query parameters and the film API -> paused Player with an ordinary seek button.
 * Used by: player.html and the J3/J8 browser journeys; excluded from the production editor entry point.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { Player, type PlayerRef } from "@remotion/player";
import { FilmView } from "../../src/dl/Film";
import { buildTimeline, totalFrames } from "../../src/dl/camera";
import { parseFilm } from "../../src/dl/schema";
import { generateWordsFromFilm } from "../../src/dl/captionsParser";
import { PALETTE } from "../../src/dl/tokens";

const query = new URLSearchParams(location.search);
const response = await fetch(`/api/films/${encodeURIComponent(query.get("film") ?? "")}`);
if (!response.ok) throw new Error(`Player fixture film: HTTP ${response.status}`);
const film = parseFilm((await response.json()).film);
const timeline = buildTimeline(film);
const captionWords = film.subtitles === false ? [] : generateWordsFromFilm(film as unknown as Record<string, unknown>);
const width = query.get("format") === "Reel" ? 1080 : 1920;
const height = query.get("format") === "Reel" ? 1920 : 1080;

// Exposes seek and isolated visibility controls outside the captured picture.
function FramePlayer() {
  const ref = React.useRef<PlayerRef>(null);
  const [testVisibility, setTestVisibility] = React.useState<{ character?: string; prop?: string }>({});
  React.useEffect(() => {
    const update = (event: Event) => setTestVisibility((event as CustomEvent<{ character?: string; prop?: string }>).detail);
    window.addEventListener("aideos-test-stage-visibility", update);
    return () => window.removeEventListener("aideos-test-stage-visibility", update);
  }, []);
  return <>
    <Player ref={ref} component={FilmView} inputProps={{ film, timeline, accent: film.accent ?? PALETTE.accent, showRail: true, showGrid: false, captionWords, testVisibility }}
      durationInFrames={totalFrames(timeline)} fps={film.fps} compositionWidth={width} compositionHeight={height}
      style={{ width, height }} controls={false} acknowledgeRemotionLicense />
    <input id="frame" aria-label="Absolute frame" type="number" defaultValue={0} />
    <button id="seek" onClick={() => ref.current?.seekTo(Number((document.getElementById("frame") as HTMLInputElement).value))}>Seek to frame</button>
  </>;
}

createRoot(document.getElementById("player")!).render(<FramePlayer />);
