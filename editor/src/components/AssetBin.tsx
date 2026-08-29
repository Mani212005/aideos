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
}

export const AssetBin: React.FC<AssetBinProps> = ({ onInsertAssetAsShot }) => {
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
