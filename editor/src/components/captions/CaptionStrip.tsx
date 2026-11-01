/**
 * File Description: Strip under the Edit preview that explains what the selected captions apply to and offers Center, Default position, Copy to the other format, Lock and Follow whole video.
 * Inputs and outputs: selection state, format, shot count, warnings and action callbacks -> a fixed-height strip of plain-language status and caption actions.
 * Used by: CaptionObject.
 */
import { AlignHorizontalJustifyCenter, Copy, LockKeyhole, RotateCcw, Subtitles, UnlockKeyhole, Undo2 } from "lucide-react";
import { Button } from "../ui";

export interface CaptionStripProps {
  selected: boolean;
  formatName: string;
  otherFormatName: string;
  shotCount: number;
  locked: boolean;
  /** True when the phrase on screen sits in a shot that has its own caption position. */
  shotException: boolean;
  /** Plain-language note about a movement limit the last drag pressed against, if any. */
  limitHint: string | null;
  artWarnings: { text: string; detail: string }[];
  unfittableWords: string[];
  onCenter: () => void;
  onDefault: () => void;
  onCopy: () => void;
  onToggleLock: () => void;
  onFollowWholeVideo: () => void;
}

// Turns the design check's technical overlap message into a short sentence with a time, keeping the original as detail.
export function describeArtWarning(message: string, fps: number): { text: string; detail: string } {
  const frame = /at frame (\d+)/.exec(message);
  if (!frame) return { text: "Covers part of the artwork in this shot", detail: message };
  const seconds = Math.floor(Number(frame[1]) / fps);
  return {
    text: `Covers part of the artwork in this shot (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`,
    detail: message,
  };
}

// Renders the always-present caption strip: a hint while nothing is selected and the actions once captions are selected.
export function CaptionStrip({
  selected,
  formatName,
  otherFormatName,
  shotCount,
  locked,
  shotException,
  limitHint,
  artWarnings,
  unfittableWords,
  onCenter,
  onDefault,
  onCopy,
  onToggleLock,
  onFollowWholeVideo,
}: CaptionStripProps) {
  const unfittable = unfittableWords[0];
  const art = artWarnings[0];
  // One status line keeps the strip a fixed height, so the preview above it never resizes while a caption is dragged.
  const warning = unfittable
    ? `\u201C${unfittable}\u201D cannot fit within two rows at this card width.`
    : art?.text;
  const warningDetail = unfittable ? undefined : art?.detail;
  const showingWarning = !(shotException && selected) && !(selected && limitHint) && !!warning;
  const message = shotException && selected
    ? "This shot has its own caption position, so moving captions here would not change it."
    : selected && limitHint
      ? limitHint
      : warning
        ? warning
        : selected
          ? `Applies to the whole video (${shotCount} ${shotCount === 1 ? "shot" : "shots"}). ${otherFormatName} keeps its own position.`
          : "Click the captions in the preview to select them, then drag to move. The position applies to the whole video.";
  return (
    <div
      data-caption-bar
      className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-ink bg-paper-2 px-3 py-1.5"
    >
      <Subtitles aria-hidden className="h-4 w-4 shrink-0 text-ink" />
      <p
        role={showingWarning ? "status" : undefined}
        title={showingWarning ? warningDetail : undefined}
        className={`min-w-0 flex-1 font-sans text-[11px] leading-snug ${showingWarning ? "text-danger-text" : selected ? "text-ink" : "text-ink-soft"}`}
      >
        {selected ? <strong className="font-bold">{formatName} captions: </strong> : null}
        {message}
      </p>
      {selected ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {shotException ? (
            <Button size="xs" tone="warn" onClick={onFollowWholeVideo} title="Remove this shot's own position so it follows the whole-video position">
              <Undo2 className="h-3 w-3" />
              Follow whole video
            </Button>
          ) : null}
          <Button size="xs" onClick={onCenter} title="Center the captions sideways">
            <AlignHorizontalJustifyCenter className="h-3 w-3" />
            Center
          </Button>
          <Button size="xs" onClick={onDefault} title="Back to the standard bottom position and automatic width">
            <RotateCcw className="h-3 w-3" />
            Default position
          </Button>
          <Button size="xs" onClick={onCopy} title={`Use this position for ${otherFormatName} too`}>
            <Copy className="h-3 w-3" />
            Copy to {otherFormatName}
          </Button>
          <Button
            size="xs"
            active={locked}
            aria-pressed={locked}
            onClick={onToggleLock}
            title="Lock (L): stops agents and rebuilds from moving the captions. You can still drag them yourself."
          >
            {locked ? <LockKeyhole className="h-3 w-3" /> : <UnlockKeyhole className="h-3 w-3" />}
            {locked ? "Unlock" : "Lock"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
