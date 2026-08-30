// File Description: Edits one shot and its blocks with interactive Character Beat inspector and pose presets.

import { useState } from "react";
import type { Film, Shot, Block } from "../../../src/dl/schema";
import { POSE_PRESETS, getAllCharacterRigs } from "../../../src/dl/characters";

interface ShotEditorProps {
  film: Film;
  shotIndex: number;
  onChange: (f: Film) => void;
  onSelectShot: (id: string) => void;
  onShotIdChange: (id: string) => void;
  onClearSelection: () => void;
}

// Renders controls for the selected shot, render mode macros, and character pose presets.
export function ShotEditor({
  film,
  shotIndex,
  onChange,
  onSelectShot,
  onShotIdChange,
  onClearSelection,
}: ShotEditorProps) {
  const shot = film.shots[shotIndex];
  const [activeKeyframeIdx, setActiveKeyframeIdx] = useState(0);

  if (!shot) return null;

  const updateShot = (partial: Partial<Shot>) => {
    const shots = [...film.shots];
    shots[shotIndex] = { ...shot, ...partial };
    onChange({ ...film, shots });
    if (partial.id && partial.id !== shot.id) onShotIdChange(partial.id);
  };

  // Delete the shot and select the nearest remaining shot, if one exists.
  const removeShot = () => {
    if (film.shots.length <= 1) return;
    const shots = film.shots.filter((_, i) => i !== shotIndex);
    onChange({ ...film, shots });
    const nextShot = shots[Math.min(shotIndex, shots.length - 1)];
    if (nextShot) onSelectShot(nextShot.id);
    else onClearSelection();
  };

  const updateBlock = (blockIndex: number, jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText);
      const blocks = [...shot.blocks];
      blocks[blockIndex] = parsed;
      updateShot({ blocks });
    } catch {
      // ignore invalid json while typing
    }
  };

  const addBlock = () => {
    updateShot({ blocks: [...shot.blocks, { c: "Body", text: "New block text" } as Block] });
  };

  const removeBlock = (blockIndex: number) => {
    const blocks = shot.blocks.filter((_, i) => i !== blockIndex);
    updateShot({ blocks });
  };

  // Identifies the active render mode based on blocks in the shot
  const hasCharacter = shot.blocks.some((b) => b.c === "CharacterBeat");
  const hasBRoll = shot.blocks.some((b) => b.c === "AnalogyInset");
  const hasMetaphor = shot.blocks.some((b) => b.c === "MetaphorViewer") || Boolean(shot.metaphor);
  const currentRenderMode = hasCharacter ? "character" : hasBRoll ? "b-roll" : hasMetaphor ? "metaphor" : "standard";

  // Applies render mode macro by swapping conflicting devices
  const setRenderMode = (mode: "standard" | "character" | "b-roll" | "metaphor") => {
    const filteredBlocks = shot.blocks.filter(
      (b) => b.c !== "CharacterBeat" && b.c !== "AnalogyInset" && b.c !== "MetaphorViewer",
    );

    if (mode === "character") {
      updateShot({
        metaphor: undefined,
        blocks: [
          ...filteredBlocks,
          {
            c: "CharacterBeat",
            characterId: "developer",
            poses: [
              {
                t: 0,
                groups: { ...POSE_PRESETS.neutral.groups },
              },
            ],
          } as Block,
        ],
      });
    } else if (mode === "metaphor") {
      updateShot({
        metaphor: "glowing-cluster",
        blocks: [
          ...filteredBlocks,
          {
            c: "MetaphorViewer",
            metaphorType: "glowing-cluster",
            content: {
              kind: "glowing-cluster",
              title: shot.blocks.find((b) => b.c === "TextReveal")?.text || "Latent Architecture",
              subtitle: "Multi-Dimensional Space",
              caption: shot.scriptText || "System Architecture",
            },
          } as Block,
        ],
      });
    } else if (mode === "b-roll") {
      updateShot({
        metaphor: undefined,
        blocks: [
          ...filteredBlocks,
          {
            c: "AnalogyInset",
            caption: shot.scriptText?.slice(0, 40) || "Visual Analogy",
          } as Block,
        ],
      });
    } else {
      updateShot({ metaphor: undefined, blocks: filteredBlocks });
    }
  };

  // Finds the index of the first CharacterBeat block
  const charBlockIdx = shot.blocks.findIndex((b) => b.c === "CharacterBeat");
  const charBlock = charBlockIdx >= 0 ? (shot.blocks[charBlockIdx] as any) : null;

  // Applies a preset pose to the active character block keyframe
  const applyPresetToKeyframe = (presetKey: string) => {
    if (charBlockIdx < 0 || !charBlock) return;
    const preset = POSE_PRESETS[presetKey];
    if (!preset) return;

    const poses = Array.isArray(charBlock.poses) && charBlock.poses.length > 0
      ? [...charBlock.poses]
      : [{ t: 0, groups: {} }];

    const targetIdx = Math.min(activeKeyframeIdx, poses.length - 1);
    poses[targetIdx] = {
      t: poses[targetIdx]?.t ?? 0,
      groups: { ...preset.groups },
    };

    const newBlocks = [...shot.blocks];
    newBlocks[charBlockIdx] = { ...charBlock, poses };
    updateShot({ blocks: newBlocks });
  };

  // Updates joint rotation for the active keyframe
  const updateJointRotation = (groupId: string, angle: number) => {
    if (charBlockIdx < 0 || !charBlock) return;
    const poses = Array.isArray(charBlock.poses) && charBlock.poses.length > 0
      ? [...charBlock.poses]
      : [{ t: 0, groups: {} }];

    const targetIdx = Math.min(activeKeyframeIdx, poses.length - 1);
    const currPose = poses[targetIdx] || { t: 0, groups: {} };
    const currGroups = currPose.groups || {};
    const currGroup = currGroups[groupId] || {};

    poses[targetIdx] = {
      ...currPose,
      groups: {
        ...currGroups,
        [groupId]: {
          ...currGroup,
          rotate: angle,
        },
      },
    };

    const newBlocks = [...shot.blocks];
    newBlocks[charBlockIdx] = { ...charBlock, poses };
    updateShot({ blocks: newBlocks });
  };

  const characterRigs = getAllCharacterRigs();

  return (
    <div className="flex flex-col gap-3 text-sm bg-[#1A1A1B] p-3 rounded border border-[#333]">
      <div className="flex justify-between items-center mb-1">
        <h3 className="font-bold text-[#F5F5F5]">Edit Shot</h3>
        <button
          onClick={removeShot}
          disabled={film.shots.length <= 1}
          className="text-red-500 text-xs hover:underline disabled:opacity-30 disabled:hover:no-underline"
        >
          Delete Shot
        </button>
      </div>

      {/* Render Mode Preset Selector */}
      <div className="flex flex-col gap-1 bg-[#111] p-2 rounded border border-[#262626]">
        <label className="text-[11px] font-semibold text-gray-300">RENDER MODE</label>
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => setRenderMode("standard")}
            className={`py-1 text-[11px] font-medium rounded transition-colors ${
              currentRenderMode === "standard"
                ? "bg-[#635BFF] text-white"
                : "bg-[#222] text-gray-400 hover:bg-[#2a2a2a]"
            }`}
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => setRenderMode("character")}
            className={`py-1 text-[11px] font-medium rounded transition-colors ${
              currentRenderMode === "character"
                ? "bg-[#635BFF] text-white"
                : "bg-[#222] text-gray-400 hover:bg-[#2a2a2a]"
            }`}
          >
            SVG Rig
          </button>
          <button
            type="button"
            onClick={() => setRenderMode("metaphor")}
            className={`py-1 text-[11px] font-medium rounded transition-colors ${
              currentRenderMode === "metaphor"
                ? "bg-[#635BFF] text-white"
                : "bg-[#222] text-gray-400 hover:bg-[#2a2a2a]"
            }`}
          >
            Metaphor
          </button>
          <button
            type="button"
            onClick={() => setRenderMode("b-roll")}
            className={`py-1 text-[11px] font-medium rounded transition-colors ${
              currentRenderMode === "b-roll"
                ? "bg-[#635BFF] text-white"
                : "bg-[#222] text-gray-400 hover:bg-[#2a2a2a]"
            }`}
          >
            B-Roll
          </button>
        </div>
      </div>

      {/* Interactive SVG Character Inspector */}
      {charBlock && (
        <div className="flex flex-col gap-2 bg-[#141416] p-2.5 rounded border border-[#635BFF]/40">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-bold text-[#635BFF] uppercase tracking-wider">
              Vector Character Rig
            </span>
            <select
              className="bg-[#222] text-xs text-white border border-[#444] rounded px-1.5 py-0.5"
              value={charBlock.characterId || "astronaut"}
              onChange={(e) => {
                const newBlocks = [...shot.blocks];
                newBlocks[charBlockIdx] = { ...charBlock, characterId: e.target.value };
                updateShot({ blocks: newBlocks });
              }}
            >
              {characterRigs.map((rig) => (
                <option key={rig.id} value={rig.id}>
                  {rig.name}
                </option>
              ))}
            </select>
          </div>

          {/* 8 Pose Preset Buttons */}
          <div className="flex flex-col gap-1 mt-1">
            <label className="text-[10px] text-gray-400">1-Click Pose Presets</label>
            <div className="grid grid-cols-4 gap-1">
              {Object.keys(POSE_PRESETS).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPresetToKeyframe(key)}
                  className="bg-[#222] hover:bg-[#333] text-gray-300 text-[10px] py-1 px-1 rounded truncate border border-[#333] hover:border-[#635BFF] transition-colors"
                  title={POSE_PRESETS[key].description}
                >
                  {POSE_PRESETS[key].name}
                </button>
              ))}
            </div>
          </div>

          {/* Keyframe Progress Selector */}
          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="text-[10px] text-gray-400">Timeline Moment</span>
            <div className="flex gap-1">
              {(charBlock.poses || []).map((p: any, idx: number) => {
                const timeLabel = p.t === 0 ? "Start (0s)" : p.t >= 0.9 ? "End" : `${(p.t * shot.dur).toFixed(1)}s`;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveKeyframeIdx(idx)}
                    className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                      activeKeyframeIdx === idx
                        ? "bg-[#635BFF] text-white font-bold"
                        : "bg-[#222] text-gray-400"
                    }`}
                  >
                    {timeLabel}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  const poses = [...(charBlock.poses || [])];
                  const newT = poses.length === 0 ? 0 : Math.min(1, (poses[poses.length - 1].t ?? 0) + 0.5);
                  poses.push({ t: newT, groups: { ...POSE_PRESETS.neutral.groups } });
                  const newBlocks = [...shot.blocks];
                  newBlocks[charBlockIdx] = { ...charBlock, poses };
                  updateShot({ blocks: newBlocks });
                  setActiveKeyframeIdx(poses.length - 1);
                }}
                className="text-[10px] px-1.5 py-0.5 bg-[#2a2a2a] hover:bg-[#333] text-gray-300 rounded font-bold"
                title="Add gesture moment"
              >
                +
              </button>
            </div>
          </div>

          {/* Joint Rotation Fine-Tuning Sliders */}
          <div className="flex flex-col gap-1.5 mt-1 border-t border-[#222] pt-2">
            <label className="text-[10px] text-gray-400">Joint Angles</label>
            {(["torso", "head", "leftArm", "rightArm"] as const).map((joint) => {
              const activePose = charBlock.poses?.[activeKeyframeIdx] || charBlock.poses?.[0];
              const angle = activePose?.groups?.[joint]?.rotate ?? 0;
              return (
                <div key={joint} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-400 capitalize w-16 truncate">{joint}</span>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={angle}
                    onChange={(e) => updateJointRotation(joint, Number(e.target.value))}
                    className="flex-1 h-1 bg-[#222] rounded accent-[#635BFF]"
                  />
                  <span className="text-[10px] font-mono text-gray-300 w-8 text-right">
                    {angle}°
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ID Field */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">ID</label>
        <input
          className="bg-[#111] border border-[#333] rounded px-2 py-1"
          value={shot.id}
          onChange={(e) => updateShot({ id: e.target.value })}
        />
      </div>

      {/* Dur & Look */}
      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Dur (s)</label>
          <input
            className="bg-[#111] border border-[#333] rounded px-2 py-1"
            type="number"
            value={shot.dur}
            onChange={(e) => updateShot({ dur: Number(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Look</label>
          <input
            className="bg-[#111] border border-[#333] rounded px-2 py-1"
            value={Array.isArray(shot.look) ? shot.look.join(",") : shot.look}
            onChange={(e) =>
              updateShot({
                look: e.target.value.includes(",") ? e.target.value.split(",") : e.target.value,
              })
            }
          />
        </div>
      </div>

      {/* Move & Stage */}
      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Move</label>
          <select
            className="bg-[#111] border border-[#333] rounded px-2 py-1"
            value={shot.move}
            onChange={(e) => updateShot({ move: e.target.value as any })}
          >
            <option value="pan">pan</option>
            <option value="zoom-in">zoom-in</option>
            <option value="zoom-out">zoom-out</option>
            <option value="hold">hold</option>
            <option value="cut">cut</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Stage</label>
          <select
            className="bg-[#111] border border-[#333] rounded px-2 py-1"
            value={shot.stage}
            onChange={(e) => updateShot({ stage: e.target.value as any })}
          >
            <option value="anchor">anchor</option>
            <option value="frame">frame</option>
            <option value="none">none</option>
          </select>
        </div>
      </div>

      {/* Voiceover Narration */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-bold">Voiceover Narration (Spoken Text)</label>
        <textarea
          className="bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs resize-y leading-relaxed text-gray-200"
          rows={3}
          value={shot.scriptText || ""}
          onChange={(e) => updateShot({ scriptText: e.target.value })}
          placeholder="Text for voiceover to speak..."
        />
      </div>

      {/* Blocks List */}
      <div className="mt-2">
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs text-gray-400">Blocks ({shot.blocks.length})</label>
          <button onClick={addBlock} className="text-xs text-[#635BFF] hover:underline">
            + Add Block
          </button>
        </div>
        {shot.blocks.map((block, bi) => (
          <div key={bi} className="relative mb-2">
            <textarea
              className="w-full bg-[#111] border border-[#333] rounded p-2 font-mono text-[10px] resize-y"
              rows={4}
              defaultValue={JSON.stringify(block, null, 2)}
              onBlur={(e) => updateBlock(bi, e.target.value)}
            />
            <button
              onClick={() => removeBlock(bi)}
              className="absolute top-1 right-2 text-red-500 text-xs font-bold bg-[#111] px-1"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
