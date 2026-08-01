import { useMemo } from "react";
import type { Film } from "../../../src/dl/schema";

interface MindMapProps {
  film: Film;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

export function MindMap({ film, selectedNodeId, onSelectNode }: MindMapProps) {
  const { nodes, edges } = film.canvas;

  // We need a bounding box to know how big the SVG should be.
  // Actually, Aideos nodes are placed absolutely in an assumed canvas space.
  // Let's just use a relative container with a large enough minimum size,
  // or calculate the bounding box.
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.w > maxX) maxX = n.x + n.w;
      if (n.y + n.h > maxY) maxY = n.y + n.h;
    });
    // Add some padding
    if (minX === Infinity) return { w: 1000, h: 1000, minX: 0, minY: 0 };
    return { 
      minX: minX - 100, 
      minY: minY - 100, 
      w: (maxX - minX) + 200, 
      h: (maxY - minY) + 200 
    };
  }, [nodes]);

  return (
    <div 
      className="relative w-full h-full bg-[#0A0A0B] overflow-auto border border-[#333] rounded-lg"
      onClick={() => onSelectNode(null)}
    >
      <div 
        className="relative"
        style={{ 
          width: Math.max(bounds.w, 800), 
          height: Math.max(bounds.h, 600),
          transform: `translate(${-bounds.minX}px, ${-bounds.minY}px)`
        }}
      >
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {edges.map((edge, i) => {
            const from = nodes.find(n => n.id === edge.from);
            const to = nodes.find(n => n.id === edge.to);
            if (!from || !to) return null;

            const fromX = from.x + from.w / 2;
            const fromY = from.y + from.h / 2;
            const toX = to.x + to.w / 2;
            const toY = to.y + to.h / 2;

            return (
              <line
                key={i}
                x1={fromX}
                y1={fromY}
                x2={toX}
                y2={toY}
                stroke={edge.dashed ? "#555" : "#777"}
                strokeWidth={2}
                strokeDasharray={edge.dashed ? "4 4" : "none"}
              />
            );
          })}
        </svg>

        {nodes.map(node => {
          const isSelected = node.id === selectedNodeId;
          return (
            <div
              key={node.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectNode(node.id);
              }}
              className={`absolute flex flex-col items-center justify-center p-2 rounded cursor-pointer transition-colors ${
                isSelected 
                  ? "bg-[#635BFF] text-white shadow-lg" 
                  : "bg-[#1A1A1B] text-[#F5F5F5] border border-[#333] hover:border-[#635BFF]"
              }`}
              style={{
                left: node.x,
                top: node.y,
                width: node.w,
                height: node.h,
              }}
            >
              <div className="font-bold text-sm text-center line-clamp-1">{node.label}</div>
              {node.sub && <div className={`text-xs text-center line-clamp-1 ${isSelected ? "text-blue-200" : "text-gray-400"}`}>{node.sub}</div>}
              {isSelected && (
                <div className="absolute -bottom-5 text-[10px] text-gray-500 font-mono">
                  {node.id}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
