/**
 * File Description: Timeline clip inspector for Aideos Studio.
 * Shows exactly what a selected clip is and lets the user set its numbers precisely rather than by
 * dragging: timeline position, source in and out points, derived duration, volume, and the lane it
 * lives on. Every change goes through the same layer-engine operations the drag gestures use, so
 * typing a number and dragging a handle produce identical, equally undoable results. A caption word
 * (a subtitle clip) shows one text control instead: the caption words are edited here, in Cut.
 * Inputs and outputs: selected clip, layer information and a caption word edit callback -> clip inspector form and properties controls.
 * Used by: editor/src/components/shell/InspectorPanel.tsx.
 */

import { useState } from "react";
import { Link2, Scissors, Trash2, Unlink } from "lucide-react";
import type { Clip } from "../../../src/dl/layeredSchema";
import type {
  AnimationPayload,
  AudioPayload,
  SubtitlePayload,
  TextPayload,
  VideoPayload,
} from "../../../src/dl/layeredSchema";
import {
  clipDuration,
  clipEndSec,
} from "../../../backend/timeline/layer_engine";
import type { LayeredTimelineApi } from "../state/useLayeredTimeline";
import { captionWordIndex } from "./captions/captionWordEdit";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  NumberStepper,
  Panel,
  PanelBody,
  PanelHeader,
  Range,
  Select,
  Stat,
} from "./ui";

const KIND_TONE = {
  animation: "select",
  video: "info",
  audio: "success",
  text: "warn",
  subtitle: "primary",
  image: "quiet",
} as const;

export interface ClipInspectorProps {
  api: LayeredTimelineApi;
  clipId: string;
  fps: number;
  onSeekFrame: (frame: number) => void;
  onClose: () => void;
  /** Sets the text of caption word `index`. */
  onEditCaptionWord: (index: number, text: string) => void;
}

/** Human summary of what a clip actually contains. */
function describeClip(clip: Clip): string {
  switch (clip.kind) {
    case "animation":
      return (
        (clip.payload as AnimationPayload).scriptText ||
        (clip.payload as AnimationPayload).shotId
      );
    case "audio":
      return (clip.payload as AudioPayload).src;
    case "video":
      return (clip.payload as VideoPayload).src;
    case "text":
      return (clip.payload as TextPayload).text;
    case "subtitle":
      return (clip.payload as SubtitlePayload).text;
    default:
      return clip.id;
  }
}

export interface CaptionWordEditorProps {
  text: string;
  startSec: number;
  endSec: number;
  fps: number;
  /** True when the lane is locked: the word shows but does not change. */
  disabled: boolean;
  onCommit: (text: string) => void;
}

/** One text control for one caption word. Enter or leaving the field saves it. Escape puts the old word back. */
function CaptionWordEditor({ text, startSec, endSec, fps, disabled, onCommit }: CaptionWordEditorProps) {
  const [draft, setDraft] = useState(text);

  /** Saves the draft when it is a new, non-empty word. An empty draft puts the old word back. */
  const commit = () => {
    const next = draft.trim();
    if (!next) setDraft(text);
    else if (next !== text) onCommit(next);
  };

  return (
    <Panel tone="flat" className="border">
      <PanelHeader title="Caption word" actions={<Badge tone="primary">{(endSec - startSec).toFixed(2)}s</Badge>} />
      <PanelBody scroll={false} className="flex flex-col gap-2 p-2">
        <Field label="Word" htmlFor="caption-word" hint={disabled ? "The lane is locked. Unlock it to edit." : undefined}>
          <Input
            id="caption-word"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") setDraft(text);
            }}
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
        <Stat label="Start" value={`${startSec.toFixed(2)}s`} />
        <Stat label="End" value={`${endSec.toFixed(2)}s`} />
        <Stat label="Frames" value={`${Math.round(startSec * fps)} to ${Math.round(endSec * fps)}`} />
      </PanelBody>
    </Panel>
  );
}

/** Precise numeric editor for one timeline clip. */
export function ClipInspector({
  api,
  clipId,
  fps,
  onSeekFrame,
  onClose,
  onEditCaptionWord,
}: ClipInspectorProps) {
  // A caption word clip id carries the word text, so it changes when the word is edited. The
  // word index in the id does not, so the inspector follows the same word through an edit.
  const wordIndex = captionWordIndex(clipId);
  const clip =
    api.layered.clips.find((c) => c.id === clipId) ??
    (wordIndex === null ? undefined : api.layered.clips.find((c) => c.kind === "subtitle" && captionWordIndex(c.id) === wordIndex));

  if (!clip) {
    return (
      <EmptyState
        title="That clip is gone"
        description="It was deleted, split or merged. Pick another clip on the timeline."
        action={
          <Button size="sm" onClick={onClose}>
            Clear selection
          </Button>
        }
      />
    );
  }

  const lane = api.layered.layers.find((l) => l.id === clip.layerId);
  const duration = clipDuration(clip);
  const soundtrackClip = /^clip-(?:music-section|soundtrack-sfx)-\d+(?:-[ab][a-z0-9]{4})*$/.test(clip.id);
  const partner = clip.linkedClipId
    ? api.layered.clips.find((c) => c.id === clip.linkedClipId)
    : undefined;
  const locked = Boolean(lane?.locked);
  const isSubtitle = clip.kind === "subtitle";
  const readOnly = locked || isSubtitle;
  const captionIndex = isSubtitle ? captionWordIndex(clip.id) : null;

  if (captionIndex !== null) {
    return (
      <div className="flex flex-col gap-3 p-2">
        <CaptionWordEditor
          key={clip.id}
          text={(clip.payload as SubtitlePayload).text}
          startSec={clip.position}
          endSec={clipEndSec(clip)}
          fps={fps}
          disabled={locked}
          onCommit={(text) => onEditCaptionWord(captionIndex, text)}
        />
        <Button size="sm" block onClick={() => onSeekFrame(Math.round(clip.position * fps))}>
          Go to word
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <Panel tone="flat" className="border">
        <PanelHeader
          title={clip.kind}
          actions={
            <Badge tone={KIND_TONE[clip.kind]}>{duration.toFixed(2)}s</Badge>
          }
        />
        <PanelBody scroll={false} className="flex flex-col gap-2 p-2">
          <p
            className="nb-clamp-2 font-mono text-xs leading-snug text-ink-soft"
            title={describeClip(clip)}
          >
            {describeClip(clip)}
          </p>
          <Stat label="Clip id" value={clip.id} />
          <Stat label="Starts" value={`${clip.position.toFixed(2)}s`} />
          <Stat label="Ends" value={`${clipEndSec(clip).toFixed(2)}s`} />
          <Stat
            label="Frames"
            value={`${Math.round(clip.position * fps)} to ${Math.round(clipEndSec(clip) * fps)}`}
          />
          {partner ? (
            <div className="mt-1 flex items-center gap-1.5 border border-line bg-select-tint px-2 py-1">
              <Link2 className="h-3 w-3" />
              <span className="truncate font-mono text-xs font-semibold">
                Linked to {partner.id}
              </span>
            </div>
          ) : null}
          {readOnly ? (
            <p className="border border-line bg-sunken px-2 py-1 font-sans text-xs leading-snug text-ink-soft">
              {locked
                ? `Lane "${lane?.label}" is locked. Unlock it to edit this clip.`
                : "This caption is a clip in the film. It is read-only."}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel tone="flat" className="border">
        <PanelHeader title="Timing" />
        <PanelBody scroll={false} className="flex flex-col gap-2.5 p-2">
          <Field label="Position" aside="seconds on the timeline">
            <NumberStepper
              value={clip.position}
              min={0}
              step={1 / fps}
              precision={3}
              unit="s"
              disabled={readOnly}
              onChange={(next) => api.moveClip(clip.id, next)}
              title="Where this clip starts on the timeline"
            />
          </Field>

          <Field label="In point" aside="into the source">
            <NumberStepper
              value={clip.start}
              min={0}
              step={1 / fps}
              precision={3}
              unit="s"
              disabled={readOnly}
              onChange={(next) =>
                api.trimClip(clip.id, "left", next - clip.start)
              }
              title="Where playback starts inside the source material"
            />
          </Field>

          <Field label="Out point" aside="into the source">
            <NumberStepper
              value={clip.end}
              min={0}
              step={1 / fps}
              precision={3}
              unit="s"
              disabled={readOnly}
              onChange={(next) =>
                api.trimClip(clip.id, "right", next - clip.end)
              }
              title="Where playback stops inside the source material"
            />
          </Field>

          <Stat
            label="Duration"
            value={`${duration.toFixed(3)}s`}
            tone="select"
          />
        </PanelBody>
      </Panel>

      {clip.kind === "audio" || clip.kind === "video" ? (
        <Panel tone="flat" className="border">
          <PanelHeader title="Level" />
          <PanelBody scroll={false} className="flex flex-col gap-1.5 p-2">
            <Field
              label="Volume"
              aside={`${Math.round((clip.volume ?? 1) * 100)}%`}
            >
              <Range
                min={0}
                max={1}
                step={0.05}
                value={clip.volume ?? 1}
                disabled={locked}
                onChange={(e) =>
                  api.setClipVolume(clip.id, Number(e.target.value))
                }
                aria-label="Clip volume"
              />
            </Field>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel tone="flat" className="border">
        <PanelHeader title="Lane" />
        <PanelBody scroll={false} className="flex flex-col gap-2 p-2">
          <Field label="On lane" htmlFor="clip-lane">
            <Select
              id="clip-lane"
              value={clip.layerId}
              disabled={readOnly}
              onChange={(e) =>
                api.moveClip(clip.id, clip.position, e.target.value)
              }
            >
              {api.lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </PanelBody>
      </Panel>

      <div className="flex flex-col gap-1.5">
        <Button
          size="sm"
          block
          onClick={() => onSeekFrame(Math.round(clip.position * fps))}
        >
          Move playhead to this clip
        </Button>
        <Button
          size="sm"
          block
          disabled={readOnly || soundtrackClip}
          onClick={() => api.splitClip(clip.id, clip.position + duration / 2)}
          title={soundtrackClip ? "Soundtrack clips cannot be split; swap the track or move the effect instead." : "Cut this clip in half"}
        >
          <Scissors className="h-3.5 w-3.5" />
          Split in half
        </Button>
        {partner ? (
          <Button
            size="sm"
            block
            disabled={locked}
            onClick={() => api.unlinkClip(clip.id)}
          >
            <Unlink className="h-3.5 w-3.5" />
            Unlink pair
          </Button>
        ) : null}
        <Button
          size="sm"
          block
          tone="danger"
          disabled={readOnly}
          onClick={() => {
            if (api.removeClip(clip.id)) onClose();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete clip
        </Button>
      </div>
    </div>
  );
}
