/**
 * File Description: Story stage for Aideos Studio.
 * The spatial map the camera travels across: nodes are the places the film visits and edges are the
 * relationships it draws between them. The stage owns the canvas actions (add node, connect nodes,
 * add a shot) so those verbs live next to the canvas instead of in a distant sidebar.
 */

import { GitBranch, Plus, Clapperboard } from "lucide-react";
import type { CanvasEdge, Film, Shot } from "../../../src/dl/schema";
import { Toolbar, ToolbarGroup, ToolbarLabel, Button, ToolbarDivider, Badge } from "../components/ui";
import { MindMap } from "../components/MindMap";

export interface StoryStageProps {
  film: Film;
  commit: (next: Film, label: string) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

/** Spatial canvas: the nodes and edges the camera moves between. */
export function StoryStage({ film, commit, selectedNodeId, onSelectNode }: StoryStageProps) {
  /** Add a fresh node near the middle of the canvas. */
  const addNode = () => {
    const nodes = [
      ...film.canvas.nodes,
      { id: `node-${Date.now()}`, label: "new node", x: 120, y: 120, w: 190, h: 62 },
    ];
    commit({ ...film, canvas: { ...film.canvas, nodes } }, "Add canvas node");
  };

  /** Connect the first two nodes that are not already connected. */
  const addEdge = () => {
    const [from, to] = film.canvas.nodes;
    if (!from || !to) return;
    const edges: CanvasEdge[] = [...film.canvas.edges, { from: from.id, to: to.id, dashed: false }];
    commit({ ...film, canvas: { ...film.canvas, edges } }, "Add canvas edge");
  };

  /** Append a new shot that looks at the first node. */
  const addShot = () => {
    const look = film.canvas.nodes[0]?.id || "all";
    const shot = {
      id: `shot-${Date.now()}`,
      dur: 6,
      look,
      move: "hold",
      stage: "anchor",
      zoom: 1,
      drift: false,
      blocks: [{ c: "Body", text: "New shot narrative and scene description." }],
    } as Shot;
    commit({ ...film, shots: [...film.shots, shot] }, "Add shot");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Toolbar seam="bottom">
        <ToolbarGroup>
          <ToolbarLabel>Canvas</ToolbarLabel>
          <Button size="sm" onClick={addNode} title="Add a node to the spatial map">
            <Plus className="h-3.5 w-3.5" />
            Node
          </Button>
          <Button
            size="sm"
            onClick={addEdge}
            disabled={film.canvas.nodes.length < 2}
            title="Connect two nodes with an edge"
          >
            <GitBranch className="h-3.5 w-3.5" />
            Edge
          </Button>
          <Button size="sm" onClick={addShot} title="Add a shot that looks at the first node">
            <Clapperboard className="h-3.5 w-3.5" />
            Shot
          </Button>
        </ToolbarGroup>
        <ToolbarDivider />
        <ToolbarGroup>
          <Badge tone="quiet">{film.canvas.nodes.length} nodes</Badge>
          <Badge tone="quiet">{film.canvas.edges.length} edges</Badge>
          <Badge tone="quiet">{film.shots.length} shots</Badge>
        </ToolbarGroup>
        <span className="ml-auto font-sans text-[10px] text-ink-mute">
          Drag a node to reposition it. Click a node to inspect it in the panel on the right.
        </span>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-hidden">
        <MindMap
          film={film}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          onNodesChange={(nodes) => commit({ ...film, canvas: { ...film.canvas, nodes } }, "Move canvas nodes")}
          onAddNode={addNode}
          onAddEdge={addEdge}
          onUpdateEdge={(index, partial) => {
            const edges = [...film.canvas.edges];
            edges[index] = { ...edges[index], ...partial };
            commit({ ...film, canvas: { ...film.canvas, edges } }, "Update canvas edge");
          }}
          onRemoveEdge={(index) => {
            if (film.canvas.edges.length <= 1) return;
            commit(
              { ...film, canvas: { ...film.canvas, edges: film.canvas.edges.filter((_, i) => i !== index) } },
              "Remove canvas edge",
            );
          }}
        />
      </div>
    </div>
  );
}
