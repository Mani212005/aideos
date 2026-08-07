import React from "react";
import { TRANSITION_PRESETS, getTransitionFrames } from "../transitions";
import type { TransitionType } from "../transitions";

export interface TransitionEditorProps {
  selectedTransition: TransitionType;
  durationSec: number;
  onSelectTransition: (type: TransitionType) => void;
  onChangeDuration: (durationSec: number) => void;
  onApplyToAll: () => void;
}

/**
 * Human Video Editor Transition Control Panel
 * Styled like Premiere Pro / After Effects transition inspector.
 */
export const TransitionEditor: React.FC<TransitionEditorProps> = ({
  selectedTransition,
  durationSec,
  onSelectTransition,
  onChangeDuration,
  onApplyToAll,
}) => {
  const activePreset = TRANSITION_PRESETS[selectedTransition] || TRANSITION_PRESETS["paper-rip"];
  const framesCount = getTransitionFrames(durationSec, 30);

  return (
    <div style={{ padding: "20px", background: "#121214", borderRadius: "12px", border: "1px solid #27272A", color: "#F4F4F5" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <span>{activePreset.icon}</span> Human Video Editor — Transition Inspector
          </h3>
          <p style={{ fontSize: "12px", color: "#A1A1AA", margin: "4px 0 0 0" }}>
            Standardized transition parameters & frame timing controls
          </p>
        </div>
        <button
          onClick={onApplyToAll}
          style={{
            background: "#10B981",
            color: "#000",
            fontWeight: 700,
            fontSize: "12px",
            border: "none",
            borderRadius: "6px",
            padding: "8px 14px",
            cursor: "pointer",
          }}
        >
          Apply to All Cut Boundaries
        </button>
      </div>

      {/* Preset Selector Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "20px" }}>
        {Object.values(TRANSITION_PRESETS).map((preset) => {
          const isSelected = preset.id === selectedTransition;
          return (
            <div
              key={preset.id}
              onClick={() => onSelectTransition(preset.id)}
              style={{
                padding: "12px",
                borderRadius: "8px",
                background: isSelected ? "rgba(16, 185, 129, 0.15)" : "#18181B",
                border: isSelected ? "2px solid #10B981" : "1px solid #27272A",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ fontSize: "20px", marginBottom: "4px" }}>{preset.icon}</div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: isSelected ? "#10B981" : "#FFF" }}>{preset.name}</div>
              <div style={{ fontSize: "11px", color: "#71717A", marginTop: "4px", lineHeight: "1.3" }}>{preset.description}</div>
            </div>
          );
        })}
      </div>

      {/* Duration & Frame Inspector */}
      <div style={{ background: "#18181B", padding: "16px", borderRadius: "8px", border: "1px solid #27272A" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13px", fontWeight: 600 }}>
          <span>TRANSITION DURATION: {durationSec.toFixed(2)}s</span>
          <span style={{ color: "#10B981", fontFamily: "monospace" }}>{framesCount} FRAMES @ 30 FPS</span>
        </div>
        <input
          type="range"
          min={activePreset.minDurationSec}
          max={activePreset.maxDurationSec}
          step="0.05"
          value={durationSec}
          onChange={(e) => onChangeDuration(parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "#10B981", cursor: "pointer" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "11px", color: "#71717A" }}>
          <span>Fast ({activePreset.minDurationSec}s)</span>
          <span>Default ({activePreset.defaultDurationSec}s)</span>
          <span>Slow ({activePreset.maxDurationSec}s)</span>
        </div>
      </div>
    </div>
  );
};
