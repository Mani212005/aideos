// File Description: Renders an interactive, Excalidraw-style movable node graph on the canvas with drag-and-drop.
import React, { useMemo, useState, useRef, useEffect } from "react";
import type { Film, CanvasNode, CanvasEdge } from "../../../src/dl/schema";

interface MindMapProps {
  film: Film;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onNodesChange?: (nodes: CanvasNode[]) => void;
  onAddNode?: () => void;
  onAddEdge?: () => void;
  onUpdateEdge?: (index: number, partial: Partial<CanvasEdge>) => void;
  onRemoveEdge?: (index: number) => void;
}

export function MindMap({
  film,
  selectedNodeId,
  onSelectNode,
  onNodesChange,
  onAddNode,
  onAddEdge,
  onUpdateEdge,
  onRemoveEdge,
}: MindMapProps) {
  const { nodes, edges } = film.canvas;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showConnections, setShowConnections] = useState<boolean>(true);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamic bounds calculation with generous padding for freeform dragging
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.w > maxX) maxX = n.x + n.w;
      if (n.y + n.h > maxY) maxY = n.y + n.h;
    });
    if (minX === Infinity) return { w: 1200, h: 900, minX: 0, minY: 0 };
    return { 
      minX: Math.min(minX - 150, 0), 
      minY: Math.min(minY - 150, 0), 
      w: Math.max((maxX - minX) + 400, 1400), 
      h: Math.max((maxY - minY) + 400, 1000) 
    };
  }, [nodes]);

  // Handle starting node drag
  const handleMouseDown = (e: React.MouseEvent, node: CanvasNode) => {
    e.stopPropagation();
    onSelectNode(node.id);
    setDraggingId(node.id);
    dragOffsetRef.current = {
      x: e.clientX - node.x,
      y: e.clientY - node.y,
    };
  };

  // Global mouse move & up listeners for smooth Excalidraw-like dragging
  useEffect(() => {
    if (!draggingId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.round((e.clientX - dragOffsetRef.current.x) / 10) * 10; // 10px soft grid snap
      const newY = Math.round((e.clientY - dragOffsetRef.current.y) / 10) * 10;

      const updatedNodes = nodes.map(n => 
        n.id === draggingId ? { ...n, x: newX, y: newY } : n
      );

      if (onNodesChange) {
        onNodesChange(updatedNodes);
      }
    };

    const handleMouseUp = () => {
      setDraggingId(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingId, nodes, onNodesChange]);

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full bg-[#0A0A0B] overflow-auto border border-[#333] rounded-lg select-none cursor-default"
      onClick={() => onSelectNode(null)}
      style={{
        backgroundImage: "radial-gradient(#222 1px, transparent 1px)",
        backgroundSize: "24px 24px"
      }}
    >
      {/* Top Controls Bar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <div className="bg-[#1A1A1B]/90 backdrop-blur px-3 py-1.5 rounded-md border border-[#333] text-xs text-gray-400 font-mono flex items-center gap-2 pointer-events-none">
          <span className="text-yellow-400 font-bold">✥ Movable Spatial Graph</span>
          <span>· {nodes.length} Nodes · {edges.length} Edges</span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowConnections((prev) => !prev);
          }}
          className={`px-3 py-1.5 rounded-md text-xs font-mono border transition-all flex items-center gap-1.5 shadow cursor-pointer ${
            showConnections
              ? "bg-[#635BFF] text-white border-[#635BFF] font-bold"
              : "bg-[#1A1A1B]/90 text-gray-300 border-[#333] hover:text-white"
          }`}
          title="Toggle Graph Connections Inspector"
        >
          <span>🕸️ Connections ({edges.length})</span>
        </button>

        {onAddNode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddNode();
            }}
            className="px-2.5 py-1.5 rounded-md text-xs font-mono bg-[#27272A] hover:bg-[#3F3F46] text-gray-200 border border-[#3F3F46] flex items-center gap-1 cursor-pointer"
          >
            <span>+ Add Node</span>
          </button>
        )}

        {onAddEdge && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddEdge();
            }}
            className="px-2.5 py-1.5 rounded-md text-xs font-mono bg-[#27272A] hover:bg-[#3F3F46] text-gray-200 border border-[#3F3F46] flex items-center gap-1 cursor-pointer"
          >
            <span>+ Add Connection</span>
          </button>
        )}
      </div>

      {/* Floating Connections & Topology Inspector */}
      {showConnections && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-14 right-3 z-30 w-80 bg-[#121214]/95 backdrop-blur border border-[#333] rounded-xl p-3 shadow-2xl flex flex-col gap-2.5 max-h-[calc(100%-5rem)] overflow-y-auto font-mono text-xs"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-[#27272A]">
            <div className="flex items-center gap-1.5">
              <span className="text-yellow-400 font-bold">🕸️ GRAPH CONNECTIONS</span>
              <span className="text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-gray-400">
                {edges.length} active
              </span>
            </div>
            <button
              onClick={() => setShowConnections(false)}
              className="text-gray-400 hover:text-white text-xs px-1 cursor-pointer"
              title="Hide Connections Inspector"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            {edges.map((edge, edgeIndex) => (
              <div
                key={`${edge.from}-${edge.to}-${edgeIndex}`}
                className="flex items-center gap-1.5 bg-[#18181B] p-1.5 rounded-lg border border-[#27272A] text-xs"
              >
                <select
                  className="min-w-0 flex-1 bg-black/60 border border-[#333] rounded px-1.5 py-1 text-[11px] text-white"
                  value={edge.from}
                  onChange={(e) => onUpdateEdge?.(edgeIndex, { from: e.target.value })}
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label || node.id}
                    </option>
                  ))}
                </select>
                <span className="text-gray-500 font-bold shrink-0">→</span>
                <select
                  className="min-w-0 flex-1 bg-black/60 border border-[#333] rounded px-1.5 py-1 text-[11px] text-white"
                  value={edge.to}
                  onChange={(e) => onUpdateEdge?.(edgeIndex, { to: e.target.value })}
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label || node.id}
                    </option>
                  ))}
                </select>
                <label
                  className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer shrink-0"
                  title="Dashed edge"
                >
                  <input
                    type="checkbox"
                    checked={edge.dashed ?? false}
                    onChange={(e) => onUpdateEdge?.(edgeIndex, { dashed: e.target.checked })}
                    className="accent-[#635BFF]"
                  />
                  <span className="text-[9px]">Dashed</span>
                </label>
                {onRemoveEdge && (
                  <button
                    onClick={() => onRemoveEdge(edgeIndex)}
                    disabled={edges.length <= 1}
                    className="px-1 text-red-400 hover:text-red-300 disabled:opacity-20 font-bold text-sm shrink-0 cursor-pointer"
                    title="Delete connection"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-[#27272A]">
            {onAddEdge && (
              <button
                onClick={onAddEdge}
                className="flex-1 py-1 px-2 rounded bg-[#27272A] hover:bg-[#3F3F46] text-gray-200 text-center text-[11px] cursor-pointer"
              >
                + Add Connection
              </button>
            )}
            {onAddNode && (
              <button
                onClick={onAddNode}
                className="flex-1 py-1 px-2 rounded bg-[#27272A] hover:bg-[#3F3F46] text-gray-200 text-center text-[11px] cursor-pointer"
              >
                + Add Node
              </button>
            )}
          </div>
        </div>
      )}

      <div 
        className="relative"
        style={{ 
          width: bounds.w, 
          height: bounds.h
        }}
      >
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {edges.map((edge, i) => {
            const from = nodes.find(n => n.id === edge.from);
            const to = nodes.find(n => n.id === edge.to);
            if (!from || !to) return null;

            const fromX = from.x + from.w / 2 - bounds.minX;
            const fromY = from.y + from.h / 2 - bounds.minY;
            const toX = to.x + to.w / 2 - bounds.minX;
            const toY = to.y + to.h / 2 - bounds.minY;

            return (
              <g key={i}>
                <line
                  x1={fromX}
                  y1={fromY}
                  x2={toX}
                  y2={toY}
                  stroke={edge.dashed ? "#635BFF88" : "#888"}
                  strokeWidth={edge.dashed ? 2 : 2.5}
                  strokeDasharray={edge.dashed ? "6 6" : "none"}
                />
                <circle cx={toX} cy={toY} r={4} fill="#635BFF" />
              </g>
            );
          })}
        </svg>

        {nodes.map(node => {
          const isSelected = node.id === selectedNodeId;
          const isDragging = node.id === draggingId;

          return (
            <div
              key={node.id}
              onMouseDown={(e) => handleMouseDown(e, node)}
              className={`absolute flex flex-col items-center justify-center p-3 rounded-xl cursor-grab transition-shadow ${
                isDragging ? "cursor-grabbing shadow-2xl scale-105 z-30 ring-2 ring-yellow-400 bg-[#635BFF]" : ""
              } ${
                isSelected && !isDragging
                  ? "bg-[#635BFF] text-white shadow-xl ring-2 ring-white/50 z-20" 
                  : "bg-[#161618] text-[#F5F5F5] border border-[#333] hover:border-yellow-400/80 z-10"
              }`}
              style={{
                left: node.x - bounds.minX,
                top: node.y - bounds.minY,
                width: node.w,
                height: node.h,
                boxShadow: isDragging ? "0 20px 30px rgba(0,0,0,0.6)" : "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              <div className="font-bold text-sm text-center line-clamp-1 pointer-events-none">
                {node.label}
              </div>
              {node.sub && (
                <div className={`text-[11px] text-center line-clamp-1 pointer-events-none ${isSelected || isDragging ? "text-blue-100" : "text-gray-400"}`}>
                  {node.sub}
                </div>
              )}
              <div className="absolute -bottom-5 text-[9px] text-gray-500 font-mono pointer-events-none">
                ({node.x}, {node.y})
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
