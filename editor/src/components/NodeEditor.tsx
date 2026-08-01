// File Description: Edits a selected mind map node and keeps its graph and shot references consistent.

import type { Film, CanvasNode, Shot } from "../../../src/dl/schema";

const asNodeId = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9-]/g, "-");

const lookAfter = (look: Shot["look"], change: (id: string) => string | null, fallback: string): Shot["look"] => {
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
export function NodeEditor({ film, nodeId, onChange, onSelectShot, onNodeIdChange, onClearSelection }: NodeEditorProps) {
  const nodeIndex = film.canvas.nodes.findIndex(n => n.id === nodeId);
  const node = film.canvas.nodes[nodeIndex];
  
  if (!node) return null;

  const updateNode = (partial: Partial<CanvasNode>) => {
    const nodes = [...film.canvas.nodes];
    nodes[nodeIndex] = { ...node, ...partial };
    onChange({ ...film, canvas: { ...film.canvas, nodes } });
  };

  // Rename the node and update every graph and shot reference.
  const renameNode = (raw: string) => {
    const from = node.id;
    const to = asNodeId(raw);
    const duplicate = film.canvas.nodes.some((candidate, index) => index !== nodeIndex && candidate.id === to);
    if (!to || duplicate || to === from) return;
    const nodes = [...film.canvas.nodes];
    nodes[nodeIndex] = { ...node, id: to };
    const edges = film.canvas.edges.map(e => ({
      ...e,
      from: e.from === from ? to : e.from,
      to: e.to === from ? to : e.to,
    }));
    const shots = film.shots.map(s => ({
      ...s,
      look: lookAfter(s.look, id => (id === from ? to : id), to),
    }));
    onChange({ ...film, canvas: { nodes, edges }, shots });
    onNodeIdChange(to);
  };

  const removeNode = () => {
    if (film.canvas.nodes.length <= 2) return;
    const gone = node.id;
    const nodes = film.canvas.nodes.filter((_, i) => i !== nodeIndex);
    let edges = film.canvas.edges.filter(e => e.from !== gone && e.to !== gone);
    if (edges.length === 0 && nodes.length >= 2) {
      edges = [{ from: nodes[0].id, to: nodes[1].id, dashed: false }];
    }
    const fallback = nodes[0]?.id ?? "all";
    const shots = film.shots.map(s => ({
      ...s,
      look: lookAfter(s.look, id => (id === gone ? null : id), fallback),
    }));
    onChange({ ...film, canvas: { nodes, edges }, shots });
    onClearSelection();
  };

  // Find related shots
  const relatedShots = film.shots.filter(s => {
    if (s.look === "all") return false;
    if (Array.isArray(s.look)) return s.look.includes(node.id);
    return s.look === node.id;
  });

  return (
    <div className="flex flex-col gap-3 text-sm bg-[#1A1A1B] p-3 rounded border border-[#333]">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-[#F5F5F5]">Edit Node</h3>
        <button 
          onClick={removeNode} 
          disabled={film.canvas.nodes.length <= 2}
          className="text-red-500 text-xs hover:underline disabled:opacity-30 disabled:hover:no-underline"
        >
          Delete
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">ID</label>
        <input className="bg-[#111] border border-[#333] rounded px-2 py-1 font-bold" value={node.id} onChange={e => renameNode(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Label</label>
        <input className="bg-[#111] border border-[#333] rounded px-2 py-1" value={node.label} onChange={e => updateNode({ label: e.target.value })} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Subtitle</label>
        <input className="bg-[#111] border border-[#333] rounded px-2 py-1" value={node.sub || ''} onChange={e => updateNode({ sub: e.target.value })} />
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">X Position</label>
          <input className="bg-[#111] border border-[#333] rounded px-2 py-1" type="number" value={node.x} onChange={e => updateNode({ x: Number(e.target.value) })} />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Y Position</label>
          <input className="bg-[#111] border border-[#333] rounded px-2 py-1" type="number" value={node.y} onChange={e => updateNode({ y: Number(e.target.value) })} />
        </div>
      </div>

      {relatedShots.length > 0 && (
        <div className="mt-4 border-t border-[#333] pt-3">
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2 block">Related Shots</label>
          <div className="flex flex-col gap-2">
            {relatedShots.map(shot => (
              <div 
                key={shot.id} 
                className="bg-[#222] p-2 rounded cursor-pointer hover:bg-[#333] transition-colors flex justify-between items-center text-xs"
                onClick={() => onSelectShot(shot.id)}
              >
                <span className="font-mono text-gray-300">{shot.id}</span>
                <span className="text-gray-500">{shot.dur}s</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
