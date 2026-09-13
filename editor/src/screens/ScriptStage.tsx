/**
 * File Description: Script stage for Aideos Studio.
 * The first step of the workflow: write or paste the screenplay, build scenes from it, and
 * synthesize the voiceover the rest of the timeline locks to. The stage frames the script editor
 * and keeps the "what do I do next" guidance visible rather than hiding it in a side panel.
 */

import type { Film } from "../../../src/dl/schema";
import type { NoteTone } from "../components/ui";
import { ScriptEditor } from "../components/ScriptEditor";

export interface ScriptStageProps {
  film: Film;
  commit: (next: Film, label: string) => void;
  notify: (tone: NoteTone, text: string) => number;
  onGoToEdit: () => void;
}

/** Screenplay authoring and voiceover synthesis. */
export function ScriptStage({ film, commit, onGoToEdit }: ScriptStageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScriptEditor
        film={film}
        onUpdateFilm={(next) => commit(next, "Update script")}
        onNavigateToVideo={onGoToEdit}
      />
    </div>
  );
}
