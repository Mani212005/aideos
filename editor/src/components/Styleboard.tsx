// File Description: Presents the film style controls, fitted mind map preview, and storyboard sequence.

import { useMemo } from "react";
import type { Film } from "../../../src/dl/schema";

interface StyleboardProps {
  film: Film;
  accent: string;
  onAccentChange: (a: string) => void;
  storyStyle: string;
  onStoryStyleChange: (s: string) => void;
  onSelectShot: (id: string) => void;
}

const ACCENTS = [
  { name: "Indigo", hex: "#635BFF" },
  { name: "Emerald", hex: "#10B981" },
  { name: "Rose", hex: "#F43F5E" },
];

const STYLES = [
  { id: "default", name: "Standard (Rail ON)" },
  { id: "minimal", name: "Minimal (Rail OFF)" },
  { id: "technical", name: "Technical (Grid + Rail)" },
];

// Calculate a padded coordinate space that contains every node and edge endpoint.
const getMapBounds = (film: Film) => {
  const { nodes } = film.canvas;
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map(node => node.x));
  const minY = Math.min(...nodes.map(node => node.y));
  const maxX = Math.max(...nodes.map(node => node.x + node.w));
  const maxY = Math.max(...nodes.map(node => node.y + node.h));
  const padding = 80;
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
};

// Renders the styleboard controls and fitted film overview.
export function Styleboard({ film, accent, onAccentChange, storyStyle, onStoryStyleChange, onSelectShot }: StyleboardProps) {
  const bounds = useMemo(() => getMapBounds(film), [film]);

  return (
    <div className="flex flex-col h-full bg-[#0A0A0B] text-[#F5F5F5] border border-[#333] rounded-lg overflow-hidden">
      <div className="flex flex-col md:flex-row gap-4 p-4 border-b border-[#333] bg-[#1A1A1B] shrink-0">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Accent Color</label>
          <div className="flex gap-2">
            {ACCENTS.map(a => (
              <button
                key={a.hex}
                onClick={() => onAccentChange(a.hex)}
                className={`w-6 h-6 rounded-full border-2 ${accent === a.hex ? "border-white scale-110" : "border-transparent"}`}
                style={{ backgroundColor: a.hex }}
                title={a.name}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Storytelling Style</label>
          <div className="flex gap-2">
            {STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => onStoryStyleChange(s.id)}
                className={`text-xs px-3 py-1 rounded border ${storyStyle === s.id ? "border-[#635BFF] text-white bg-[#635BFF]/10" : "border-[#333] text-gray-400 hover:border-gray-500"}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-1/3 shrink-0 flex flex-col gap-2">
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Mind Map Context</label>
          <div className="relative aspect-video bg-[#111] border border-[#333] rounded overflow-hidden flex items-center justify-center">
            <div className="relative w-full h-full">
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {film.canvas.edges.map((edge, i) => {
                  const from = film.canvas.nodes.find(n => n.id === edge.from);
                  const to = film.canvas.nodes.find(n => n.id === edge.to);
                  if (!from || !to) return null;
                  return (
                    <line
                      key={i}
                      x1={from.x + from.w / 2} y1={from.y + from.h / 2}
                      x2={to.x + to.w / 2} y2={to.y + to.h / 2}
                      stroke={edge.dashed ? "#444" : "#666"} strokeWidth={4}
                      strokeDasharray={edge.dashed ? "8 8" : "none"}
                    />
                  );
                })}
                {film.canvas.nodes.map(node => (
                  <g key={node.id}>
                    <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={8} fill="#222" stroke="#555" strokeWidth={3} />
                    <text x={node.x + node.w / 2} y={node.y + node.h / 2} fill="white" textAnchor="middle" dominantBaseline="middle" fontSize={18}>
                      {node.label}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-4">
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Storyboard Sequence</label>
          <div className="flex flex-col gap-3">
            {film.shots.map((shot, i) => (
              <div
                key={shot.id}
                className="bg-[#1A1A1B] border border-[#333] rounded-lg p-3 flex flex-col gap-2 hover:border-[#635BFF] cursor-pointer transition-colors"
                onClick={() => onSelectShot(shot.id)}
              >
                <div className="flex justify-between items-center border-b border-[#333] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-[#222] text-xs px-2 py-0.5 rounded font-mono text-gray-300">Shot {i + 1}</span>
                    <span className="font-bold text-sm">{shot.id}</span>
                  </div>
                  <div className="text-xs text-gray-400 font-mono">{shot.dur}s</div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-gray-300">
                  <div><span className="text-gray-500">Look: </span>{Array.isArray(shot.look) ? shot.look.join(", ") : shot.look}</div>
                  <div><span className="text-gray-500">Stage: </span>{shot.stage}</div>
                  <div><span className="text-gray-500">Move: </span>{shot.move}</div>
                </div>
                {shot.scriptText && <div className="text-xs italic text-gray-400 mt-1 border-l-2 border-[#333] pl-2">"{shot.scriptText}"</div>}
                {shot.blocks.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {shot.blocks.map((b, bi) => (
                      <span key={bi} className="text-[10px] bg-[#222] border border-[#444] px-1.5 py-0.5 rounded text-gray-300" style={{ borderColor: storyStyle === "minimal" ? "#333" : accent }}>
                        {b.c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
