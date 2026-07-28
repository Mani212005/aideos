import { useEffect, useState, useMemo } from "react";
import { Player } from "@remotion/player";
import { FilmView } from "../../src/dl/Film";
import { buildTimeline, totalFrames } from "../../src/dl/camera";
import { kvcacheFilm } from "../../src/dl/films/kvcache";
import type { Film } from "../../src/dl/schema";
import { CanvasEditor } from "./components/CanvasEditor";
import { TimelineEditor } from "./components/TimelineEditor";

// Every film module in src/dl/films, keyed by the id the save API writes it
// back under. Films export one const, so the module's first export is the film.
const filmModules = import.meta.glob("../../src/dl/films/*.ts", { eager: true }) as Record<
  string,
  Record<string, Film>
>;

const filmsById = new Map<string, Film>(
  Object.entries(filmModules).flatMap(([file, mod]) => {
    const id = file.split("/").pop()?.replace(/\.ts$/, "");
    const film = Object.values(mod)[0];
    return id && film ? [[id, film] as [string, Film]] : [];
  }),
);

// The two compositions in src/Root.tsx are one film seen through two viewports,
// and reel framing is what moving a node breaks first — so both preview here.
const FORMATS = {
  long: { width: 1920, height: 1080 },
  reel: { width: 1080, height: 1920 },
};

type Format = keyof typeof FORMATS;

export default function App() {
  const [film, setFilm] = useState<Film>(kvcacheFilm);
  const [format, setFormat] = useState<Format>("long");
  const [filmIds, setFilmIds] = useState<string[]>([...filmsById.keys()]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // The server owns src/dl/films; the bundler owns what can actually be opened.
  useEffect(() => {
    let live = true;
    fetch("/api/films")
      .then((r) => r.json() as Promise<string[]>)
      .then((ids) => {
        if (live) setFilmIds(ids.filter((id) => filmsById.has(id)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

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
    setStatus(null);
    try {
      const res = await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film })
      });
      const payload = (await res.json().catch(() => null)) as
        | { file?: string; error?: string; issues?: string[] }
        | null;
      if (!res.ok) {
        setStatus({
          ok: false,
          text: payload?.issues?.join("\n") ?? payload?.error ?? `Save failed (${res.status})`,
        });
        return;
      }
      setStatus({ ok: true, text: `Saved ${payload?.file ?? `${film.id}.ts`}` });
    } catch (e) {
      console.error(e);
      setStatus({ ok: false, text: e instanceof Error ? e.message : "Failed to save." });
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

        {status ? (
          <pre
            className={`whitespace-pre-wrap text-xs rounded p-2 border ${
              status.ok
                ? "border-[#333] text-gray-400"
                : "border-red-900 text-red-400 bg-[#1A0F10]"
            }`}
          >
            {status.text}
          </pre>
        ) : null}

        <div className="flex flex-col gap-2">
          <label className="text-sm text-gray-400">Film</label>
          <select
            className="bg-[#1A1A1B] border border-[#333] rounded px-2 py-1 text-sm"
            value={film.id}
            onChange={e => {
              const next = filmsById.get(e.target.value);
              if (!next) return;
              setFilm(next);
              setStatus(null);
            }}
          >
            {filmIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
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
      <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden relative">
        <div className="flex gap-2 shrink-0">
          {(Object.keys(FORMATS) as Format[]).map(f => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`text-xs px-3 py-1 rounded border ${
                format === f ? "border-[#635BFF] text-white" : "border-[#333] text-gray-400"
              }`}
            >
              {f} · {FORMATS[f].width}×{FORMATS[f].height}
            </button>
          ))}
        </div>
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
              compositionWidth={FORMATS[format].width}
              compositionHeight={FORMATS[format].height}
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
