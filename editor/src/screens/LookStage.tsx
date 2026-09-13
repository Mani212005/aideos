/**
 * File Description: Look stage for Aideos Studio.
 * Merges the two screens that both answered "how does this film look": the project-wide theme
 * (palette, typography, video type, camera) and the per-shot styleboard. They are sub-views of one
 * stage because a user thinking about look moves between them constantly, and keeping them apart
 * made the old top navigation disagree with the side rail.
 */

import { useState } from "react";
import { LayoutGrid, Palette } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { SegmentedTabs, Toolbar, ToolbarGroup, ToolbarLabel } from "../components/ui";
import { CustomizationEditor } from "../components/CustomizationEditor";
import { Styleboard } from "../components/Styleboard";

type LookView = "theme" | "styleboard";

export interface LookStageProps {
  film: Film;
  commit: (next: Film, label: string) => void;
  accent: string;
  onAccentChange: (color: string) => void;
  onSelectShot: (id: string) => void;
}

/** Project theme and per-shot styleboard, as two views of one stage. */
export function LookStage({ film, commit, accent, onAccentChange, onSelectShot }: LookStageProps) {
  const [view, setView] = useState<LookView>("theme");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Toolbar seam="bottom">
        <ToolbarGroup>
          <ToolbarLabel>View</ToolbarLabel>
          <SegmentedTabs
            ariaLabel="Look view"
            value={view}
            onChange={setView}
            items={[
              { value: "theme", label: "Theme", icon: <Palette className="h-3.5 w-3.5" /> },
              { value: "styleboard", label: "Styleboard", icon: <LayoutGrid className="h-3.5 w-3.5" />, suffix: String(film.shots.length) },
            ]}
          />
        </ToolbarGroup>
        <span className="ml-auto font-sans text-[10px] text-ink-mute">
          {view === "theme"
            ? "Theme choices apply to the whole film and are written into its manifest."
            : "Each card is one shot. Click a card to inspect it on the right."}
        </span>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "theme" ? (
          <CustomizationEditor
            film={film}
            onUpdateFilm={(next) => commit(next, "Update theme")}
            accent={accent}
            onAccentChange={onAccentChange}
          />
        ) : (
          <Styleboard
            film={film}
            accent={accent}
            onAccentChange={onAccentChange}
            onSelectShot={onSelectShot}
            onUpdateFilm={(next) => commit(next, "Update styleboard")}
          />
        )}
      </div>
    </div>
  );
}
