import React, { useState, useMemo } from "react";
import { Player } from "@remotion/player";
import { FilmView } from "../../src/dl/Film";
import { buildTimeline, totalFrames } from "../../src/dl/camera";
import { kvcacheFilm } from "../../src/dl/films/kvcache";
import type { Film } from "../../src/dl/schema";
import { CanvasEditor } from "./components/CanvasEditor";
import { TimelineEditor } from "./components/TimelineEditor";

export default function App() {
  const [film, setFilm] = useState<Film>(kvcacheFilm);
  const [saving, setSaving] = useState(false);

  const timeline = useMemo(() => {
    try {
      return buildTimeline(film);
    } catch(e) {
      console.error(e);
      return null;
    }
  }, [film]);

  const duration = timeline ? totalFrames(timeline) : 300;

  const handleSave = async () => {
    setSaving(true);
    try {
      const code = `import type { Film } from "../schema";\n\nexport const ${film.id}Film: Film = ${JSON.stringify(film, null, 2)};\n`;
      const res = await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: code })
      });
      if (!res.ok) throw new Error("Save failed");
      alert("Saved successfully!");
    } catch (e) {
      console.error(e);
      alert("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0A0A0B] text-[#F5F5F5] overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 border-r border-[#333] p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold">Aideos Editor</h1>
          <button 
            className="bg-[#635BFF] text-white px-3 py-1 rounded text-sm disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        
        <div className="flex flex-col gap-2">
          <label className="text-sm text-gray-400">Title</label>
          <input 
            className="bg-[#1A1A1B] border border-[#333] rounded px-2 py-1 text-sm focus:outline-none focus:border-[#635BFF]"
            value={film.title}
            onChange={e => setFilm({...film, title: e.target.value})}
          />
        </div>
        
        <CanvasEditor film={film} onChange={setFilm} />
        <TimelineEditor film={film} onChange={setFilm} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden relative">
        <div className="flex-1 flex items-center justify-center min-h-0 bg-black rounded-lg border border-[#333] overflow-hidden">
          {timeline ? (
            <Player
              component={FilmView}
              inputProps={{
                film,
                timeline,
                accent: film.accent || "#635BFF",
                showGrid: false,
                showRail: true,
              }}
              durationInFrames={duration}
              fps={film.fps}
              compositionWidth={1920}
              compositionHeight={1080}
              style={{ width: "100%", height: "100%" }}
              controls
              autoPlay
              loop
            />
          ) : (
            <div className="text-red-500">Error building timeline. Check console.</div>
          )}
        </div>
      </div>
    </div>
  );
}
