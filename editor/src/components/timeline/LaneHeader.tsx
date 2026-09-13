/**
 * File Description: Lane header column for the Aideos timeline.
 * One row per layer, carrying the lane name, its z-order position, the visibility, lock and mute
 * toggles that the layer model actually honours, and the reorder and delete controls. Renaming is
 * inline so a lane can be named without leaving the timeline.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Trash2, Volume2, VolumeX } from "lucide-react";
import type { Layer } from "../../../../src/dl/layeredSchema";
import { Badge, Button, IconToggle, cn } from "../ui";

export interface LaneHeaderProps {
  layer: Layer;
  clipCount: number;
  height: number;
  selected: boolean;
  /** True when this lane is the drop target of the drag in flight. */
  isDropTarget: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: (label: string) => void;
  onToggle: (patch: Partial<Pick<Layer, "locked" | "hidden" | "muted">>) => void;
  onShift: (direction: "up" | "down") => void;
  onDelete: () => void;
}

/** One lane row in the timeline's left header column. */
export function LaneHeader({
  layer,
  clipCount,
  height,
  selected,
  isDropTarget,
  canMoveUp,
  canMoveDown,
  canDelete,
  onSelect,
  onRename,
  onToggle,
  onShift,
  onDelete,
}: LaneHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(layer.label);
  }, [layer.label]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  /** Save the inline rename, ignoring an empty name. */
  const commitRename = () => {
    setEditing(false);
    const next = draft.trim().slice(0, 40);
    if (next && next !== layer.label) onRename(next);
    else setDraft(layer.label);
  };

  return (
    <div
      onClick={onSelect}
      style={{ height }}
      className={cn(
        "flex shrink-0 flex-col justify-between gap-1 border-b-2 border-ink px-2 py-1.5",
        selected ? "bg-select/15" : "bg-paper-2",
        isDropTarget && "bg-primary/40",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Badge tone="quiet" className="px-1 py-0 font-mono text-[9px]" title={`Z-order ${layer.number}`}>
          {layer.number}
        </Badge>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(layer.label);
                setEditing(false);
              }
              e.stopPropagation();
            }}
            className="min-w-0 flex-1 border-2 border-select bg-paper-3 px-1 py-0.5 font-sans text-[11px] font-bold text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            title={`${layer.label} (double click to rename)`}
            className="min-w-0 flex-1 truncate text-left font-sans text-[11px] font-extrabold uppercase tracking-[0.04em] text-ink"
          >
            {layer.label}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-0.5">
          <IconToggle
            size="xs"
            on={!layer.hidden}
            tone="info"
            onChange={(next) => onToggle({ hidden: !next })}
            onIcon={<Eye className="h-2.5 w-2.5" />}
            offIcon={<EyeOff className="h-2.5 w-2.5" />}
            title={layer.hidden ? `Show ${layer.label}` : `Hide ${layer.label}`}
          />
          <IconToggle
            size="xs"
            on={!layer.muted}
            tone="primary"
            onChange={(next) => onToggle({ muted: !next })}
            onIcon={<Volume2 className="h-2.5 w-2.5" />}
            offIcon={<VolumeX className="h-2.5 w-2.5" />}
            title={layer.muted ? `Unmute ${layer.label}` : `Mute ${layer.label}`}
          />
          <IconToggle
            size="xs"
            on={layer.locked}
            tone="danger"
            onChange={(next) => onToggle({ locked: next })}
            onIcon={<Lock className="h-2.5 w-2.5" />}
            offIcon={<LockOpen className="h-2.5 w-2.5" />}
            title={layer.locked ? `Unlock ${layer.label}` : `Lock ${layer.label}`}
          />
          <span
            className="ml-1 shrink-0 font-mono text-[9px] tabular-nums text-ink-mute"
            title={`${clipCount} clips on this lane`}
          >
            {clipCount}
          </span>
        </div>

        {height >= 56 ? (
          <div className="flex items-center gap-0.5">
            <Button
              tone="ghost"
              size="xs"
              iconOnly
              disabled={!canMoveUp}
              onClick={(e) => {
                e.stopPropagation();
                onShift("up");
              }}
              title="Move lane up in z-order"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              tone="ghost"
              size="xs"
              iconOnly
              disabled={!canMoveDown}
              onClick={(e) => {
                e.stopPropagation();
                onShift("down");
              }}
              title="Move lane down in z-order"
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <Button
              tone="ghost"
              size="xs"
              iconOnly
              disabled={!canDelete}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title={canDelete ? `Delete lane "${layer.label}" and its clips` : "A film needs at least one lane"}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
