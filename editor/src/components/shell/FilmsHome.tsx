/**
 * File Description: The Films home. It lists every film with its state chip (Draft, Fail, Pass, Old, OK) and holds the Start box. Pick a film to open it in Words. It replaces the project select and the New project button of the old header.
 * Inputs and outputs: the film ids, the open film and two callbacks -> the home screen; picking a film calls onOpen, starting a film calls onStarted.
 * Used by: editor/src/App.tsx.
 */

import type { Film } from "../../../../src/dl/schema";
import { useFilmStates } from "../../state/useFilmStates";
import { Card, Panel, cn } from "../ui";
import { StateChip } from "../StateChip";
import { StartBox } from "./StartBox";

export interface FilmsHomeProps {
  filmIds: readonly string[];
  openId: string;
  onOpen: (id: string) => void;
  onStarted: (film: Film) => void;
}

/** The home screen: Start box on top, the films below. */
export function FilmsHome({ filmIds, openId, onOpen, onStarted }: FilmsHomeProps) {
  const states = useFilmStates(filmIds, true);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-4" data-testid="films-home">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
        <Panel className="p-3">
          <StartBox filmIds={filmIds} onStarted={onStarted} />
        </Panel>
        <h1 className="font-sans text-lg font-semibold text-ink">Films</h1>
        <ul className="flex flex-col gap-1.5" aria-label="Films">
          {filmIds.map((id) => {
            const load = states[id];
            return (
              <li key={id}>
                <Card
                  interactive
                  selected={id === openId}
                  role="button"
                  tabIndex={0}
                  aria-label={id}
                  aria-current={id === openId ? "true" : undefined}
                  onClick={() => onOpen(id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(id);
                    }
                  }}
                  className={cn("flex min-h-11 items-center justify-between gap-3 px-3 py-2")}
                >
                  <span className="min-w-0 truncate font-mono text-xs font-semibold text-ink">{id}</span>
                  {load?.status === "ready" ? <StateChip state={load.state} /> : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
