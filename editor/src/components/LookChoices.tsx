/**
 * File Description: The two film-wide choices of the Look lens: the accent colour and the background. A pick is one undo step on the film itself. The accent goes through the shell's own accent setter, so a chosen accent still reaches the film, its manifest and the primary buttons (the accentChosen binding is kept: this component never clears or sets it).
 * Inputs and outputs: film, the accent on screen, accent and background setters -> two small groups of choice buttons.
 * Used by: editor/src/screens/LookStage.tsx.
 */

import type { BackgroundPreset, Film } from "../../../src/dl/schema";
import { BACKGROUND_THEMES } from "../../../src/dl/tokens";
import { ACCENT_CHOICES, sameColour } from "../../../src/projectTheme";
import { Panel, PanelBody, cn } from "./ui";

// One short word for each background preset.
const BACKGROUND_LABEL: Record<BackgroundPreset, string> = {
  "paper-white": "Paper",
  parchment: "Parchment",
  blueprint: "Blueprint",
  charcoal: "Charcoal",
  "dot-grid": "Dots",
  "smooth-dark": "Dark",
};

export interface LookChoicesProps {
  film: Film;
  accent: string;
  onAccentChange: (color: string) => void;
  onBackgroundChange: (background: BackgroundPreset) => void;
}

/** The accent and background of the film, as two groups of choice buttons. */
export function LookChoices({ film, accent, onAccentChange, onBackgroundChange }: LookChoicesProps) {
  const background: BackgroundPreset = film.theme?.background ?? "paper-white";
  // A film can carry an accent that is not in the list. It stays on screen as the chosen one.
  const accents = ACCENT_CHOICES.some((a) => sameColour(a.hex, accent)) ? ACCENT_CHOICES : [{ name: accent, hex: accent }, ...ACCENT_CHOICES];

  return (
    <Panel>
      <PanelBody scroll={false} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-xs font-semibold text-ink-soft">Accent</h3>
          <div role="radiogroup" aria-label="Accent" className="flex flex-wrap gap-1.5">
            {accents.map((a) => {
              const on = sameColour(a.hex, accent);
              return (
                <button
                  key={a.hex}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={a.name}
                  title={`${a.name} ${a.hex}`}
                  onClick={() => (on ? undefined : onAccentChange(a.hex))}
                  className={cn(
                    "h-7 w-7 rounded-md border border-line transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-select",
                    on && "ring-2 ring-select ring-offset-2 ring-offset-paper-2",
                  )}
                  style={{ backgroundColor: a.hex }}
                />
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-xs font-semibold text-ink-soft">Background</h3>
          <div role="radiogroup" aria-label="Background" className="flex flex-wrap gap-1.5">
            {Object.values(BACKGROUND_THEMES).map((bg) => {
              const on = background === bg.id;
              return (
                <button
                  key={bg.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={bg.name}
                  onClick={() => (on ? undefined : onBackgroundChange(bg.id))}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1 font-sans text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-select",
                    on ? "border-select bg-select-tint font-semibold text-ink" : "border-line bg-paper-3 text-ink-soft hover:text-ink",
                  )}
                >
                  {/* The swatch is the video theme's own canvas colour, so the pick shows what the film gets. */}
                  <span className="h-3.5 w-3.5 rounded-sm border border-line" style={{ backgroundColor: bg.canvas }} />
                  {BACKGROUND_LABEL[bg.id]}
                </button>
              );
            })}
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}
