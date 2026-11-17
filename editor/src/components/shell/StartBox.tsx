/**
 * File Description: The Start box. One field, the story, and one button. Press Start and the studio names the film from the first words, compiles a first cut and opens Words. It replaces the New project dialog, which asked for a title, an id, a script, a theme and a voice before the film existed.
 * Inputs and outputs: the film ids that exist -> a story box; on Start the new film is passed to onStarted.
 * Used by: editor/src/components/shell/FilmsHome.tsx.
 */

import { useState } from "react";
import type { Film } from "../../../../src/dl/schema";
import { startFilm } from "../../state/startFilm";
import { Button, Note, Spinner, Textarea } from "../ui";

export interface StartBoxProps {
  /** The ids of the films that exist, so the new film gets an id of its own. */
  filmIds: readonly string[];
  /** Called with the new film once the server has made it. */
  onStarted: (film: Film) => void;
}

/** The story field with its Start button. */
export function StartBox({ filmIds, onStarted }: StartBoxProps) {
  const [story, setStory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Makes the film from the story and hands it on, or shows why it failed.
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onStarted(await startFilm(story, filmIds));
      setStory("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (story.trim() && !busy) void start();
      }}
    >
      <Textarea
        id="start-story"
        aria-label="Story"
        value={story}
        onChange={(e) => setStory(e.target.value)}
        rows={5}
        placeholder="Story"
        disabled={busy}
      />
      {error ? <Note tone="danger">{error}</Note> : null}
      <div className="flex justify-end">
        <Button type="submit" tone="primary" size="md" disabled={busy || !story.trim()}>
          {busy ? <Spinner /> : null}
          Start
        </Button>
      </div>
    </form>
  );
}
