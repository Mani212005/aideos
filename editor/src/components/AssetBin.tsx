/**
 * File Description: Media Library & Asset Bin Component for Aideos Studio (Phase T-E).
 * Allows users to upload and manage MP4/MOV videos, WAV/MP3 audio, and PNG/SVG images,
 * and drag or click to insert them as clips on the timeline.
 */

import React, { useState, useEffect, useRef } from "react";

export interface MediaAsset {
  id: string;
  filename: string;
  src: string;
  type: "video" | "audio" | "image";
  duration?: number;
  sizeBytes?: number;
}

interface AssetBinProps {
  onInsertAssetAsShot: (asset: MediaAsset) => void;
  compact?: boolean;
}

export const AssetBin: React.FC<AssetBinProps> = ({ onInsertAssetAsShot, compact = false }) => {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch asset bin files
  const refreshAssets = async () => {
    try {
      const res = await fetch("/api/media/list");
      if (res.ok) {
        const data = await res.json();
        if (data.assets) setAssets(data.assets);
      }
    } catch {
      // Ignore network error
    }
  };

  useEffect(() => {
    refreshAssets();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(",")[1];
        const res = await fetch("/api/media/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, base64Data }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Upload failed");
        }

        const data = await res.json();
        if (data.asset) {
          setAssets((prev) => [data.asset, ...prev.filter((a) => a.id !== data.asset.id)]);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (compact) {
    return (
      <div className="flex flex-col gap-2 bg-[#141416] p-2.5 rounded-xl border border-[#27272A] font-mono text-xs">
        {/* Compact Header */}
        <div className="flex items-center justify-between pb-1.5 border-b border-[#27272A]">
          <div className="flex items-center gap-1.5">
            <span className="text-yellow-400 font-bold text-[11px] uppercase tracking-wider">📁 MEDIA ASSETS</span>
            <span className="text-[9px] bg-black/60 px-1 py-0.5 rounded text-gray-400 font-bold">
              {assets.length}
            </span>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/svg+xml,audio/wav,audio/mpeg"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="text-[10px] px-2 py-0.5 rounded bg-[#635BFF] hover:bg-[#5248E5] text-white font-bold shadow flex items-center gap-1 disabled:opacity-50 cursor-pointer"
            title="Upload MP4, MOV, PNG, JPG, or WAV asset"
          >
            <span>{isUploading ? "⏳" : "➕ Upload"}</span>
          </button>
        </div>

        {uploadError && (
          <div className="p-1.5 rounded bg-red-950/80 border border-red-500 text-red-300 text-[10px]">
            ⚠️ {uploadError}
          </div>
        )}

        {/* Compact Asset List */}
        <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
          {assets.length === 0 ? (
            <div className="py-3 text-center text-gray-500 text-[10px]">
              No media uploaded yet. Click ➕ Upload to add video/audio.
            </div>
          ) : (
            assets.map((asset) => (
              <div
                key={asset.id}
                className="bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] hover:border-yellow-400/80 rounded-lg p-1.5 flex items-center justify-between gap-1.5 transition-all text-[11px]"
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-xs shrink-0">
                    {asset.type === "video" ? "🎬" : asset.type === "audio" ? "🎵" : "🖼️"}
                  </span>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-gray-200 truncate font-sans font-medium" title={asset.filename}>
                      {asset.filename}
                    </span>
                    {asset.duration !== undefined && asset.duration > 0 && (
                      <span className="text-[9px] text-gray-400 font-mono">
                        {asset.duration.toFixed(1)}s
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onInsertAssetAsShot(asset)}
                  className="px-2 py-1 bg-[#635BFF] hover:bg-yellow-400 hover:text-black text-white text-[10px] font-bold rounded shadow shrink-0 transition-colors cursor-pointer"
                  title="Insert asset as shot into the film timeline"
                >
                  + Insert
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0E0E10] text-[#E1E1E6] p-4 gap-3 overflow-y-auto">
      {/* Upload Zone */}
      <div className="flex items-center justify-between bg-[#18181B] p-3 rounded-xl border border-[#27272A]">
        <div>
          <h3 className="font-bold text-xs text-yellow-400">📁 Media Library & Asset Bin</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Upload MP4, MOV, PNG, JPG, or WAV assets and click to insert them as clips on the timeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/svg+xml,audio/wav,audio/mpeg"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="text-xs px-3 py-1.5 rounded-lg bg-[#635BFF] hover:bg-[#5248E5] text-white font-bold shadow flex items-center gap-1 disabled:opacity-50"
          >
            <span>{isUploading ? "⏳ Uploading..." : "➕ Upload Media"}</span>
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="p-2.5 rounded bg-red-950/80 border border-red-500 text-red-300 text-xs">
          ⚠️ {uploadError}
        </div>
      )}

      {/* Asset Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {assets.length === 0 ? (
          <div className="col-span-full py-12 text-center text-gray-500 text-xs font-mono">
            (No external media assets uploaded yet. Click Upload Media above to add footage.)
          </div>
        ) : (
          assets.map((asset) => (
            <div
              key={asset.id}
              onClick={() => onInsertAssetAsShot(asset)}
              className="bg-[#141416] border border-[#27272A] hover:border-yellow-400 rounded-xl p-2.5 flex flex-col justify-between gap-2 cursor-pointer transition-all hover:scale-[1.02] group shadow"
            >
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-yellow-300 font-bold">
                  {asset.type === "video" ? "🎬 Video" : asset.type === "audio" ? "🎵 Audio" : "🖼️ Image"}
                </span>
                {asset.duration && (
                  <span className="text-[10px] text-gray-400 bg-black/60 px-1.5 py-0.5 rounded">
                    {asset.duration.toFixed(1)}s
                  </span>
                )}
              </div>

              <div className="text-xs text-gray-200 font-bold truncate group-hover:text-yellow-300" title={asset.filename}>
                {asset.filename}
              </div>

              <button
                className="w-full text-[10px] py-1 rounded bg-[#27272A] group-hover:bg-yellow-400 group-hover:text-black font-bold transition-colors"
              >
                + Add to Timeline
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
