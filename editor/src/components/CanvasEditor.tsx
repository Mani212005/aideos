import type { Film, Shot, CanvasNode, CanvasEdge } from "../../../src/dl/schema";

// The schema's node id rule, applied as you type: an id that cannot be authored
// here is an id that cannot dangle in an edge or a shot's `look` either.
const asNodeId = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9-]/g, "-");

// A shot names nodes, never coordinates — so a rename or a delete has to travel
// through every `look` that names the node, or the camera silently reframes.
const lookAfter = (look: Shot["look"], change: (id: string) => string | null, fallback: string): Shot["look"] => {
  if (look === "all") return look;
  if (Array.isArray(look)) {
    const kept = look.map(change).filter((id): id is string => id !== null);
    return kept.length > 0 ? kept : fallback;
  }
  return change(look) ?? fallback;
};

export function CanvasEditor({ film, onChange }: { film: Film, onChange: (f: Film) => void }) {
  const updateNode = (index: number, partial: Partial<CanvasNode>) => {
    const nodes = [...film.canvas.nodes];
    nodes[index] = { ...nodes[index], ...partial };
    onChange({ ...film, canvas: { ...film.canvas, nodes } });
  };

  const renameNode = (index: number, raw: string) => {
    const from = film.canvas.nodes[index].id;
    const to = asNodeId(raw);
    if (to === from) return;
    const nodes = [...film.canvas.nodes];
    nodes[index] = { ...nodes[index], id: to };
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
  };

  const addNode = () => {
    const nodes = [...film.canvas.nodes, { id: `node-${Date.now()}`, label: "new node", x: 100, y: 100, w: 190, h: 62 }];
    onChange({ ...film, canvas: { ...film.canvas, nodes } });
  };

  const removeNode = (index: number) => {
    const gone = film.canvas.nodes[index].id;
    const nodes = film.canvas.nodes.filter((_, i) => i !== index);
    const edges = film.canvas.edges.filter(e => e.from !== gone && e.to !== gone);
    const fallback = nodes[0]?.id ?? "all";
    const shots = film.shots.map(s => ({
      ...s,
      look: lookAfter(s.look, id => (id === gone ? null : id), fallback),
    }));
    onChange({ ...film, canvas: { nodes, edges }, shots });
  };

  const updateEdge = (index: number, partial: Partial<CanvasEdge>) => {
    const edges = [...film.canvas.edges];
    edges[index] = { ...edges[index], ...partial };
    onChange({ ...film, canvas: { ...film.canvas, edges } });
  };

  const addEdge = () => {
    const edges = [...film.canvas.edges, { from: film.canvas.nodes[0]?.id || "", to: film.canvas.nodes[0]?.id || "", dashed: false }];
    onChange({ ...film, canvas: { ...film.canvas, edges } });
  };

  const removeEdge = (index: number) => {
    const edges = film.canvas.edges.filter((_, i) => i !== index);
    onChange({ ...film, canvas: { ...film.canvas, edges } });
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex justify-between items-center mt-4">
        <h2 className="font-bold">Nodes</h2>
        <button onClick={addNode} className="text-xs bg-[#222] px-2 py-1 rounded">Add Node</button>
      </div>
      {film.canvas.nodes.map((node, i) => (
        <div key={i} className="border border-[#333] p-2 rounded bg-[#1A1A1B] flex flex-col gap-2">
          <div className="flex justify-between">
            <input className="bg-transparent font-bold w-24" value={node.id} onChange={e => renameNode(i, e.target.value)} />
            <button onClick={() => removeNode(i)} className="text-red-500">X</button>
          </div>
          <input className="bg-transparent border-b border-[#333]" placeholder="Label" value={node.label} onChange={e => updateNode(i, { label: e.target.value })} />
          <input className="bg-transparent border-b border-[#333]" placeholder="Sub" value={node.sub || ''} onChange={e => updateNode(i, { sub: e.target.value })} />
          <div className="flex gap-2 text-xs">
            X: <input className="bg-[#222] w-12 px-1" type="number" value={node.x} onChange={e => updateNode(i, { x: Number(e.target.value) })} />
            Y: <input className="bg-[#222] w-12 px-1" type="number" value={node.y} onChange={e => updateNode(i, { y: Number(e.target.value) })} />
          </div>
        </div>
      ))}

      <div className="flex justify-between items-center mt-4 border-t border-[#333] pt-4">
        <h2 className="font-bold">Edges</h2>
        <button onClick={addEdge} className="text-xs bg-[#222] px-2 py-1 rounded">Add Edge</button>
      </div>
      {film.canvas.edges.map((edge, i) => (
        <div key={i} className="border border-[#333] p-2 rounded bg-[#1A1A1B] flex flex-col gap-2">
          <div className="flex gap-2 justify-between items-center">
            <select className="bg-[#222] flex-1 px-1" value={edge.from} onChange={e => updateEdge(i, { from: e.target.value })}>
              {film.canvas.nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
            </select>
            <span>-&gt;</span>
            <select className="bg-[#222] flex-1 px-1" value={edge.to} onChange={e => updateEdge(i, { to: e.target.value })}>
              {film.canvas.nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
            </select>
            <button onClick={() => removeEdge(i)} className="text-red-500">X</button>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={edge.dashed} onChange={e => updateEdge(i, { dashed: e.target.checked })} />
            Dashed
          </label>
        </div>
      ))}
    </div>
  );
}