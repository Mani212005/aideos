/**
 * File Description: Transition inspector for Aideos Studio.
 * Picks the transition played when the camera enters a shot and sets its length, showing the frame
 * count that length actually produces so a choice can be judged in frames rather than in vague
 * seconds. Rendered inside the shot inspector, and able to push the same choice onto every shot.
 */

import React from "react";
import { Flame, MoveRight, Scissors, Zap, ZoomIn } from "lucide-react";
import { TRANSITION_PRESETS, getTransitionFrames } from "../transitions";
import type { TransitionType } from "../transitions";
import { Badge, Button, Card, Field, Range, Stat, cn } from "./ui";

export interface TransitionEditorProps {
  selectedTransition: TransitionType;
  durationSec: number;
  fps?: number;
  onSelectTransition: (type: TransitionType) => void;
  onChangeDuration: (durationSec: number) => void;
  onApplyToAll: () => void;
}

const TRANSITION_ICONS: Record<TransitionType, React.ComponentType<{ className?: string }>> = {
  "paper-rip": Scissors,
  "zoom-morph": ZoomIn,
  "matrix-glitch": Zap,
  "whip-pan": MoveRight,
  "film-burn": Flame,
};

/** Preset picker and frame-accurate duration control for a shot's entry transition. */
export const TransitionEditor: React.FC<TransitionEditorProps> = ({
  selectedTransition,
  durationSec,
  fps = 30,
  onSelectTransition,
  onChangeDuration,
  onApplyToAll,
}) => {
  const activePreset = TRANSITION_PRESETS[selectedTransition] || TRANSITION_PRESETS["paper-rip"];
  const framesCount = getTransitionFrames(durationSec, fps);

  return (
    <div className="flex flex-col gap-2 border-2 border-ink bg-paper-3 p-2.5 shadow-nb-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-soft">
          Entry transition
        </span>
        <Button size="xs" onClick={onApplyToAll} title="Use this transition on every shot">
          Apply to all
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {Object.values(TRANSITION_PRESETS).map((preset) => {
          const isSelected = preset.id === selectedTransition;
          const Icon = TRANSITION_ICONS[preset.id] || Scissors;
          return (
            <Card
              key={preset.id}
              interactive
              selected={isSelected}
              onClick={() => onSelectTransition(preset.id)}
              className="flex flex-col gap-0.5 p-1.5"
              title={preset.description}
            >
              <span className="flex items-center gap-1 font-sans text-[10px] font-extrabold uppercase tracking-[0.04em]">
                <Icon className="h-3 w-3 shrink-0" />
                {preset.name}
              </span>
              <span className={cn("nb-clamp-2 font-sans text-[9px] leading-snug", isSelected ? "opacity-90" : "text-ink-mute")}>
                {preset.description}
              </span>
            </Card>
          );
        })}
      </div>

      <Field
        label="Duration"
        aside={`${durationSec.toFixed(2)}s`}
        hint={`Fast ${activePreset.minDurationSec}s, default ${activePreset.defaultDurationSec}s, slow ${activePreset.maxDurationSec}s`}
      >
        <Range
          min={activePreset.minDurationSec}
          max={activePreset.maxDurationSec}
          step={0.05}
          value={durationSec}
          onChange={(e) => onChangeDuration(parseFloat(e.target.value))}
          aria-label="Transition duration"
        />
      </Field>

      <div className="flex items-center justify-between gap-2">
        <Stat label="Frames" value={framesCount} tone="select" className="flex-1" />
        <Badge tone="quiet">{fps} fps</Badge>
      </div>
    </div>
  );
};
