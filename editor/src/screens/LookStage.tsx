/**
 * File Description: Look lens for Aideos Studio. One lens, no sub-views. It shows the chosen shot as a picture with the Ask box under it (components/LookAsk.tsx), the footage action for a shot that needs footage, the look plan, the two film-wide choices (accent and background) and the shots with their pictures. The old theme gallery, Styleboard and shot modal are gone: texture, fonts, camera angle and per-shot fields are not director choices here, and an agent changes them through Ask.
 * Inputs and outputs: film project, accent, chosen shot -> the Look lens; accent and background changes as film commits.
 * Used by: editor/src/App.tsx.
 */

import { useEffect, useState } from "react";
import type { BackgroundPreset, Film } from "../../../src/dl/schema";
import { DesignView } from "../components/DesignView";
import { LookAsk } from "../components/LookAsk";
import { LookChoices } from "../components/LookChoices";
import { LookFootage } from "../components/LookFootage";
import type { NoteTone } from "../components/ui";

export interface LookStageProps {
  film: Film;
  commit: (next: Film, label: string) => void;
  accent: string;
  onAccentChange: (color: string) => void;
  onSelectShot: (id: string) => void;
  notify: (tone: NoteTone, text: string) => number;
}

/** The Look lens: picture, Ask, look plan, accent, background and the shots. */
export function LookStage({ film, commit, accent, onAccentChange, onSelectShot, notify }: LookStageProps) {
  // The shot that Ask applies to. It follows the shot list and the Shot select.
  const [shotId, setShotId] = useState(film.shots[0]?.id ?? "");
  // Keep the chosen shot valid when the film changes under it.
  useEffect(() => {
    if (!film.shots.some((s) => s.id === shotId)) setShotId(film.shots[0]?.id ?? "");
  }, [film.shots, shotId]);
  // Choose a shot for Ask and tell the shell.
  const chooseShot = (id: string) => {
    setShotId(id);
    onSelectShot(id);
  };
  // Sets the film background as one undo step.
  const setBackground = (background: BackgroundPreset) => {
    commit({ ...film, theme: { ...(film.theme ?? {}), background } }, "Change background");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DesignView
        film={film}
        onSelectShot={chooseShot}
        selectedShotId={shotId}
        topPanel={
          <>
            <LookAsk film={film} shotId={shotId} onShotChange={chooseShot} notify={notify} />
            <LookFootage film={film} shotId={shotId} commit={commit} />
          </>
        }
        choicesPanel={<LookChoices film={film} accent={accent} onAccentChange={onAccentChange} onBackgroundChange={setBackground} />}
      />
    </div>
  );
}
