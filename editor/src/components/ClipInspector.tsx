/**
 * File Description: Timeline clip inspector for Aideos Studio.
 * Shows exactly what a selected clip is and lets the user set its numbers precisely rather than by
 * dragging: timeline position, source in and out points, derived duration, volume, and the lane it
 * lives on. Every change goes through the same layer-engine operations the drag gestures use, so
 * typing a number and dragging a handle produce identical, equally undoable results.
 */

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
import {
  Badge,
  Button,
  EmptyState,
  Field,
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

/** Precise numeric editor for one timeline clip. */
export function ClipInspector({
  api,
  clipId,
  fps,
  onSeekFrame,
  onClose,
}: ClipInspectorProps) {
  const clip = api.layered.clips.find((c) => c.id === clipId);

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
  const partner = clip.linkedClipId
    ? api.layered.clips.find((c) => c.id === clip.linkedClipId)
    : undefined;
  const locked = Boolean(lane?.locked);
  const isSubtitle = clip.kind === "subtitle";
  const readOnly = locked || isSubtitle;

  return (
    <div className="flex flex-col gap-3 p-2">
      <Panel tone="flat" className="border-2">
        <PanelHeader
          title={clip.kind}
          actions={
            <Badge tone={KIND_TONE[clip.kind]}>{duration.toFixed(2)}s</Badge>
          }
        />
        <PanelBody scroll={false} className="flex flex-col gap-2 p-2">
          <p
            className="nb-clamp-2 font-mono text-[10px] leading-snug text-ink-soft"
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
            <div className="mt-1 flex items-center gap-1.5 border-2 border-ink bg-primary px-2 py-1 shadow-nb-sm">
              <Link2 className="h-3 w-3" />
              <span className="truncate font-mono text-[10px] font-bold">
                Linked to {partner.id}
              </span>
            </div>
          ) : null}
          {readOnly ? (
            <p className="border-2 border-ink bg-sunken px-2 py-1 font-sans text-[10px] leading-snug text-ink-soft shadow-nb-sm">
              {locked
                ? `Lane "${lane?.label}" is locked. Unlock it in the timeline to edit this clip.`
                : "Subtitle cues are generated from the caption track. Edit their timing in the Captions stage."}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel tone="flat" className="border-2">
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
        <Panel tone="flat" className="border-2">
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

      <Panel tone="flat" className="border-2">
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
          disabled={readOnly}
          onClick={() => api.splitClip(clip.id, clip.position + duration / 2)}
          title="Cut this clip in half"
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
