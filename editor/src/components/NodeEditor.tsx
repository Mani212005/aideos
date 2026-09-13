// File Description: Edits a selected mind map node and keeps its graph and shot references consistent.

import { useState, useEffect } from "react";
import type { Film, CanvasNode, Shot } from "../../../src/dl/schema";

// Normalizes a raw string into a valid Aideos node ID.
const asNodeId = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9-]/g, "-");

// Updates a shot's 'look' reference when a node is renamed or deleted.
const lookAfter = (
  look: Shot["look"],
  change: (id: string) => string | null,
  fallback: string,
): Shot["look"] => {
  if (look === "all") return look;
  if (Array.isArray(look)) {
    const kept = look.map(change).filter((id): id is string => id !== null);
    return kept.length > 0 ? kept : fallback;
  }
  return change(look) ?? fallback;
};

interface NodeEditorProps {
  film: Film;
  nodeId: string;
  onChange: (f: Film) => void;
  onSelectShot: (id: string) => void;
  onNodeIdChange: (id: string) => void;
  onClearSelection: () => void;
}

// Renders controls for the selected node and its related shots.
export function NodeEditor({
  film,
  nodeId,
  onChange,
  onSelectShot,
  onNodeIdChange,
  onClearSelection,
}: NodeEditorProps) {
  const nodeIndex = film.canvas.nodes.findIndex((n) => n.id === nodeId);
  const node = film.canvas.nodes[nodeIndex];

  const [localId, setLocalId] = useState(node?.id || "");
  useEffect(() => {
    if (node?.id) setLocalId(node.id);
  }, [node?.id]);

  if (!node) return null;

  const updateNode = (partial: Partial<CanvasNode>) => {
    const nodes = [...film.canvas.nodes];
    nodes[nodeIndex] = { ...node, ...partial };
    onChange({ ...film, canvas: { ...film.canvas, nodes } });
  };

  // Rename the node and update every graph and shot reference.
  const commitRename = () => {
    const from = node.id;
    const to = asNodeId(localId);
    const duplicate = film.canvas.nodes.some(
      (candidate, index) => index !== nodeIndex && candidate.id === to,
    );
    if (!to || duplicate || to === from) {
      setLocalId(from);
      return;
    }
    const nodes = [...film.canvas.nodes];
    nodes[nodeIndex] = { ...node, id: to };
    const edges = film.canvas.edges.map((e) => ({
      ...e,
      from: e.from === from ? to : e.from,
      to: e.to === from ? to : e.to,
    }));
    const shots = film.shots.map((s) => ({
      ...s,
      look: lookAfter(s.look, (id) => (id === from ? to : id), to),
    }));
    onChange({ ...film, canvas: { nodes, edges }, shots });
    onNodeIdChange(to);
  };

  const removeNode = () => {
    if (film.canvas.nodes.length <= 2) return;
    const gone = node.id;
    const nodes = film.canvas.nodes.filter((_, i) => i !== nodeIndex);
    let edges = film.canvas.edges.filter(
      (e) => e.from !== gone && e.to !== gone,
    );
    if (edges.length === 0 && nodes.length >= 2) {
      edges = [{ from: nodes[0].id, to: nodes[1].id, dashed: false }];
    }
    const fallback = nodes[0]?.id ?? "all";
    const shots = film.shots.map((s) => ({
      ...s,
      look: lookAfter(s.look, (id) => (id === gone ? null : id), fallback),
    }));
    onChange({ ...film, canvas: { nodes, edges }, shots });
    onClearSelection();
  };

  // Find related shots
  const relatedShots = film.shots.filter((s) => {
    if (s.look === "all") return false;
    if (Array.isArray(s.look)) return s.look.includes(node.id);
    return s.look === node.id;
  });

  return (
    <div className="flex flex-col gap-3 text-sm bg-paper-3 p-3 border-2 border-ink shadow-nb-sm">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-ink">Edit Node</h3>
        <button
          onClick={removeNode}
          disabled={film.canvas.nodes.length <= 2}
          className="text-ink text-xs hover:underline disabled:opacity-30 disabled:hover:no-underline"
        >
          Delete
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-soft">ID</label>
        <input
          className="bg-paper-3 border-2 border-ink px-2 py-1 font-bold shadow-nb-sm"
          value={localId}
          onChange={(e) => setLocalId(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === "Enter" && commitRename()}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-soft">Label</label>
        <input
          className="bg-paper-3 border-2 border-ink px-2 py-1 shadow-nb-sm"
          value={node.label}
          onChange={(e) => updateNode({ label: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-soft">Subtitle</label>
        <input
          className="bg-paper-3 border-2 border-ink px-2 py-1 shadow-nb-sm"
          value={node.sub || ""}
          onChange={(e) => updateNode({ sub: e.target.value })}
        />
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-ink-soft">X Position</label>
          <input
            className="bg-paper-3 border-2 border-ink px-2 py-1 shadow-nb-sm"
            type="number"
            value={node.x}
            onChange={(e) => updateNode({ x: Number(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-ink-soft">Y Position</label>
          <input
            className="bg-paper-3 border-2 border-ink px-2 py-1 shadow-nb-sm"
            type="number"
            value={node.y}
            onChange={(e) => updateNode({ y: Number(e.target.value) })}
          />
        </div>
      </div>

      {relatedShots.length > 0 && (
        <div className="mt-4 border-t-2 border-ink pt-3">
          <label className="text-xs text-ink-soft font-bold uppercase tracking-wider mb-2 block">
            Related Shots
          </label>
          <div className="flex flex-col gap-2">
            {relatedShots.map((shot) => (
              <div
                key={shot.id}
                className="bg-sunken p-2 cursor-pointer hover:bg-sunken transition-colors flex justify-between items-center text-xs"
                onClick={() => onSelectShot(shot.id)}
              >
                <span className="font-mono text-ink">{shot.id}</span>
                <span className="text-ink-soft">{shot.dur}s</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
