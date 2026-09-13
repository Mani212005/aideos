/**
 * File Description: Spatial story canvas for Aideos Studio.
 * Draws the film's concept graph as draggable outlined node cards on a dot grid, with a connection
 * inspector for editing the edges between them. The canvas owns positioning and selection; the
 * Story stage owns the verbs that create nodes, edges and shots.
 */
import React, { useMemo, useState, useRef, useEffect } from "react";
import type { Film, CanvasNode, CanvasEdge } from "../../../src/dl/schema";
import { Share2, X, ArrowRight } from "lucide-react";

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
  const [showConnections, setShowConnections] = useState<boolean>(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamic bounds calculation with generous padding for freeform dragging
  const bounds = useMemo(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.w > maxX) maxX = n.x + n.w;
      if (n.y + n.h > maxY) maxY = n.y + n.h;
    });
    if (minX === Infinity) return { w: 1200, h: 900, minX: 0, minY: 0 };
    return {
      minX: Math.min(minX - 150, 0),
      minY: Math.min(minY - 150, 0),
      w: Math.max(maxX - minX + 400, 1400),
      h: Math.max(maxY - minY + 400, 1000),
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

      const updatedNodes = nodes.map((n) =>
        n.id === draggingId ? { ...n, x: newX, y: newY } : n,
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
      className="relative w-full h-full bg-paper overflow-auto border-2 border-ink select-none cursor-default shadow-nb-sm"
      onClick={() => onSelectNode(null)}
      style={{
        backgroundImage: "radial-gradient(color-mix(in srgb, var(--nb-ink) 22%, transparent) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* The Story stage owns the add-node and add-edge verbs, so the canvas only carries the
          controls that belong to the canvas itself. */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowConnections((prev) => !prev);
          }}
          className={`flex cursor-pointer items-center gap-1.5 border-2 border-ink px-3 py-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${
            showConnections ? "bg-select text-select-ink" : "bg-paper-3 text-ink"
          }`}
          title="Show or hide the connection inspector"
        >
          <Share2 size={12} />
          <span>Connections ({edges.length})</span>
        </button>
      </div>

      {/* Floating Connections & Topology Inspector */}
      {showConnections && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-14 right-3 z-30 w-80 bg-paper-3/95 border-2 border-ink p-3 shadow-nb-sm flex flex-col gap-2.5 max-h-[calc(100%-5rem)] overflow-y-auto font-mono text-xs"
        >
          <div className="flex items-center justify-between pb-1.5 border-b-2 border-ink">
            <div className="flex items-center gap-1.5">
              <Share2 size={12} className="text-ink" />
              <span className="text-ink font-bold">GRAPH CONNECTIONS</span>
              <span className="text-[10px] bg-sunken px-1.5 py-0.5 text-ink-soft">
                {edges.length} active
              </span>
            </div>
            <button
              onClick={() => setShowConnections(false)}
              className="text-ink-soft hover:text-ink text-xs px-1 cursor-pointer"
              title="Hide Connections Inspector"
            >
              <X size={12} />
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            {edges.map((edge, edgeIndex) => (
              <div
                key={`${edge.from}-${edge.to}-${edgeIndex}`}
                className="flex items-center gap-1.5 bg-paper-3 p-1.5 border-2 border-ink text-xs shadow-nb-sm"
              >
                <select
                  className="min-w-0 flex-1 bg-sunken border-2 border-ink px-1.5 py-1 text-[11px] text-ink shadow-nb-sm"
                  value={edge.from}
                  onChange={(e) =>
                    onUpdateEdge?.(edgeIndex, { from: e.target.value })
                  }
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label || node.id}
                    </option>
                  ))}
                </select>
                <ArrowRight className="w-3.5 h-3.5 text-ink-soft shrink-0" />
                <select
                  className="min-w-0 flex-1 bg-sunken border-2 border-ink px-1.5 py-1 text-[11px] text-ink shadow-nb-sm"
                  value={edge.to}
                  onChange={(e) =>
                    onUpdateEdge?.(edgeIndex, { to: e.target.value })
                  }
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label || node.id}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[10px] text-ink-soft shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(edge.dashed)}
                    onChange={(e) =>
                      onUpdateEdge?.(edgeIndex, { dashed: e.target.checked })
                    }
                  />
                  dashed
                </label>
                {onRemoveEdge && (
                  <button
                    onClick={() => onRemoveEdge(edgeIndex)}
                    className="p-1 text-ink hover:text-ink disabled:opacity-20 shrink-0 cursor-pointer"
                    title="Delete connection"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1 border-t-2 border-ink">
            {onAddEdge && (
              <button
                onClick={onAddEdge}
                className="flex-1 py-1 px-2 bg-sunken hover:bg-sunken text-ink text-center text-[11px] cursor-pointer"
              >
                + Add Connection
              </button>
            )}
            {onAddNode && (
              <button
                onClick={onAddNode}
                className="flex-1 py-1 px-2 bg-sunken hover:bg-sunken text-ink text-center text-[11px] cursor-pointer"
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
          height: bounds.h,
        }}
      >
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {edges.map((edge, i) => {
            const from = nodes.find((n) => n.id === edge.from);
            const to = nodes.find((n) => n.id === edge.to);
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

        {nodes.map((node) => {
          const isSelected = node.id === selectedNodeId;
          const isDragging = node.id === draggingId;

          return (
            <div
              key={node.id}
              onMouseDown={(e) => handleMouseDown(e, node)}
              className={`absolute flex flex-col items-center justify-center p-3 cursor-grab transition-shadow ${
                isDragging
                  ? "cursor-grabbing shadow-nb-sm scale-105 z-30 ring-2 ring-select bg-select"
                  : ""
              } ${
                isSelected && !isDragging
                  ? "bg-select text-select-ink shadow-nb-sm ring-2 ring-select z-20"
                  : "bg-paper-3 text-ink border-2 border-ink hover:border-ink/80 z-10"
              }`}
              style={{
                left: node.x - bounds.minX,
                top: node.y - bounds.minY,
                width: node.w,
                height: node.h,
                boxShadow: isDragging
                  ? "0 20px 30px rgba(0,0,0,0.6)"
                  : "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              <div className="font-bold text-sm text-center line-clamp-1 pointer-events-none">
                {node.label}
              </div>
              {node.sub && (
                <div
                  className={`text-[11px] text-center line-clamp-1 pointer-events-none ${isSelected || isDragging ? "text-ink" : "text-ink-soft"}`}
                >
                  {node.sub}
                </div>
              )}
              <div className="absolute -bottom-5 text-[9px] text-ink-soft font-mono pointer-events-none">
                ({node.x}, {node.y})
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
