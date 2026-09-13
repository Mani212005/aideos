/**
 * File Description: Media bin for Aideos Studio.
 * Lists the MP4, MOV, WAV, MP3, PNG and SVG assets available to the open project, uploads new ones,
 * and is the drag source that feeds the timeline. Each row is a full drag handle carrying the asset
 * payload, so it can be dropped onto a specific lane at a specific time, and also offers a click
 * action that drops it at the playhead for users who would rather not drag.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Film, Image as ImageIcon, Music, Plus, Upload } from "lucide-react";
import { Badge, Button, Card, EmptyState, Note, PanelHeader, Spinner, cn } from "./ui";

export interface MediaAsset {
  id: string;
  filename: string;
  src: string;
  type: "video" | "audio" | "image";
  duration?: number;
  sizeBytes?: number;
}

export interface AssetBinProps {
  /** Insert the asset at the playhead on its natural lane. */
  onInsertAssetAsShot: (asset: MediaAsset) => void;
}

const TYPE_ICON = {
  video: Film,
  audio: Music,
  image: ImageIcon,
} as const;

const TYPE_TONE = {
  video: "info",
  audio: "success",
  image: "primary",
} as const;

/** Format a byte count for a dense list row. */
function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

/** Media library and drag source for the timeline. */
export const AssetBin: React.FC<AssetBinProps> = ({ onInsertAssetAsShot }) => {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Reload the asset list from the dev server. */
  const refreshAssets = useCallback(async () => {
    try {
      const res = await fetch("/api/media/list");
      if (!res.ok) return;
      const data = await res.json();
      if (data.assets) setAssets(data.assets as MediaAsset[]);
    } catch {
      // The bin is additive: a failed list must not break the Edit stage.
    }
  }, []);

  useEffect(() => {
    void refreshAssets();
  }, [refreshAssets]);

  /** Upload the chosen file and prepend it to the bin. */
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    const reader = new FileReader();
    reader.onerror = () => {
      setUploadError("That file could not be read.");
      setIsUploading(false);
    };
    reader.onload = async () => {
      try {
        const base64Data = (reader.result as string).split(",")[1];
        const res = await fetch("/api/media/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, base64Data }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Upload failed");
        }
        const data = await res.json();
        if (data.asset) {
          setAssets((prev) => [data.asset as MediaAsset, ...prev.filter((a) => a.id !== data.asset.id)]);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  }, []);

  /** Put the asset payload on the drag event so the timeline can place it precisely. */
  const handleDragStart = (e: React.DragEvent, asset: MediaAsset) => {
    e.dataTransfer.setData("application/json", JSON.stringify(asset));
    e.dataTransfer.setData("text/plain", asset.src);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Media bin"
        actions={
          <>
            <Badge tone="quiet">{assets.length}</Badge>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/svg+xml,audio/wav,audio/mpeg"
              className="hidden"
              aria-label="Upload a media file"
            />
            <Button
              size="xs"
              tone="primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              title="Upload MP4, MOV, WAV, MP3, PNG, JPG or SVG"
            >
              {isUploading ? <Spinner /> : <Upload className="h-3 w-3" />}
              Add
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {uploadError ? (
          <Note tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" />} className="mb-2">
            {uploadError}
          </Note>
        ) : null}

        {assets.length === 0 ? (
          <EmptyState
            icon={<Upload className="h-5 w-5" />}
            title="No media yet"
            description="Add footage, music or stills, then drag them onto a timeline lane."
            action={
              <Button size="sm" tone="primary" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                Upload media
              </Button>
            }
            className="min-h-[220px]"
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {assets.map((asset) => {
              const Icon = TYPE_ICON[asset.type] ?? Film;
              return (
                <li key={asset.id}>
                  <Card
                    draggable
                    onDragStart={(e) => handleDragStart(e, asset)}
                    className={cn("flex cursor-grab flex-col gap-1.5 p-2 active:cursor-grabbing")}
                    title={`${asset.filename}\nDrag onto a lane, or use Add to timeline to drop it at the playhead.`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center border-2 border-ink bg-sunken">
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-sans text-[11px] font-bold">
                        {asset.filename}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1">
                        <Badge tone={TYPE_TONE[asset.type] ?? "quiet"} className="px-1 py-0">
                          {asset.type}
                        </Badge>
                        {asset.sizeBytes ? (
                          <span className="font-mono text-[9px] text-ink-mute">{formatSize(asset.sizeBytes)}</span>
                        ) : null}
                      </span>
                      <Button
                        size="xs"
                        onClick={() => onInsertAssetAsShot(asset)}
                        title="Drop this asset at the playhead"
                      >
                        <Plus className="h-3 w-3" />
                        Add
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="shrink-0 border-t-2 border-ink bg-paper px-2 py-1.5 font-sans text-[10px] leading-snug text-ink-mute">
        Drag a row onto any lane to place it at that exact time, or press Add to drop it at the playhead.
      </p>
    </div>
  );
};
