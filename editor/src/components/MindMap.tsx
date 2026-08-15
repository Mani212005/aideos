// File Description: Renders an interactive, Excalidraw-style movable node graph on the canvas with drag-and-drop.
import React, { useMemo, useState, useRef, useEffect } from "react";
import type { Film, CanvasNode } from "../../../src/dl/schema";

interface MindMapProps {
  film: Film;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onNodesChange?: (nodes: CanvasNode[]) => void;
}

export function MindMap({ film, selectedNodeId, onSelectNode, onNodesChange }: MindMapProps) {
  const { nodes, edges } = film.canvas;
  const [draggingId, setDraggingId] = useState<string | null>(null);
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
      <div className="absolute top-3 left-3 z-10 bg-[#1A1A1B]/90 backdrop-blur px-3 py-1.5 rounded-md border border-[#333] text-xs text-gray-400 font-mono flex items-center gap-2 pointer-events-none">
        <span className="text-yellow-400 font-bold">✥ Excalidraw Movable Canvas</span>
        <span>· Drag any node to reposition camera & layout</span>
      </div>

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
