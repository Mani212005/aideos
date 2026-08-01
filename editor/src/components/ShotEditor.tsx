// File Description: Edits one shot and its blocks while preserving selection after deletion.

import type { Film, Shot, Block } from "../../../src/dl/schema";

interface ShotEditorProps {
  film: Film;
  shotIndex: number;
  onChange: (f: Film) => void;
  onSelectShot: (id: string) => void;
  onShotIdChange: (id: string) => void;
  onClearSelection: () => void;
}

// Renders controls for the selected shot and its storyboard blocks.
export function ShotEditor({ film, shotIndex, onChange, onSelectShot, onShotIdChange, onClearSelection }: ShotEditorProps) {
  const shot = film.shots[shotIndex];
  if (!shot) return null;

  const updateShot = (partial: Partial<Shot>) => {
    const shots = [...film.shots];
    shots[shotIndex] = { ...shot, ...partial };
    onChange({ ...film, shots });
    if (partial.id && partial.id !== shot.id) onShotIdChange(partial.id);
  };

  // Delete the shot and select the nearest remaining shot, if one exists.
  const removeShot = () => {
    if (film.shots.length <= 1) return;
    const shots = film.shots.filter((_, i) => i !== shotIndex);
    onChange({ ...film, shots });
    const nextShot = shots[Math.min(shotIndex, shots.length - 1)];
    if (nextShot) onSelectShot(nextShot.id);
    else onClearSelection();
  };

  const updateBlock = (blockIndex: number, jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText);
      const blocks = [...shot.blocks];
      blocks[blockIndex] = parsed;
      updateShot({ blocks });
    } catch (e) {
      // ignore invalid json while typing
    }
  };

  const addBlock = () => {
    updateShot({ blocks: [...shot.blocks, { c: "Body", text: "New block text" } as Block] });
  };

  const removeBlock = (blockIndex: number) => {
    const blocks = shot.blocks.filter((_, i) => i !== blockIndex);
    updateShot({ blocks });
  };

  return (
    <div className="flex flex-col gap-3 text-sm bg-[#1A1A1B] p-3 rounded border border-[#333]">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-[#F5F5F5]">Edit Shot</h3>
        <button 
          onClick={removeShot} 
          disabled={film.shots.length <= 1}
          className="text-red-500 text-xs hover:underline disabled:opacity-30 disabled:hover:no-underline"
        >
          Delete Shot
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">ID</label>
        <input className="bg-[#111] border border-[#333] rounded px-2 py-1" value={shot.id} onChange={e => updateShot({ id: e.target.value })} />
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Dur (s)</label>
          <input className="bg-[#111] border border-[#333] rounded px-2 py-1" type="number" value={shot.dur} onChange={e => updateShot({ dur: Number(e.target.value) })} />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Look</label>
          <input className="bg-[#111] border border-[#333] rounded px-2 py-1" value={Array.isArray(shot.look) ? shot.look.join(',') : shot.look} onChange={e => updateShot({ look: e.target.value.includes(',') ? e.target.value.split(',') : e.target.value })} />
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Move</label>
          <select className="bg-[#111] border border-[#333] rounded px-2 py-1" value={shot.move} onChange={e => updateShot({ move: e.target.value as any })}>
            <option value="pan">pan</option>
            <option value="zoom-in">zoom-in</option>
            <option value="zoom-out">zoom-out</option>
            <option value="hold">hold</option>
            <option value="cut">cut</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-gray-400">Stage</label>
          <select className="bg-[#111] border border-[#333] rounded px-2 py-1" value={shot.stage} onChange={e => updateShot({ stage: e.target.value as any })}>
            <option value="anchor">anchor</option>
            <option value="frame">frame</option>
            <option value="none">none</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Script (TTS)</label>
        <textarea
          className="bg-[#111] border border-[#333] rounded px-2 py-1 text-xs resize-y"
          rows={3}
          value={shot.scriptText || ''}
          onChange={e => updateShot({ scriptText: e.target.value })}
          placeholder="Text for Voiceover to speak..."
        />
      </div>

      <div className="mt-2">
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs text-gray-400">Blocks</label>
          <button onClick={addBlock} className="text-xs text-[#635BFF] hover:underline">+ Add Block</button>
        </div>
        {shot.blocks.map((block, bi) => (
          <div key={bi} className="relative mb-2">
            <textarea 
              className="w-full bg-[#111] border border-[#333] rounded p-2 font-mono text-[10px] resize-y" 
              rows={4}
              defaultValue={JSON.stringify(block, null, 2)}
              onBlur={e => updateBlock(bi, e.target.value)}
            />
            <button 
              onClick={() => removeBlock(bi)}
              className="absolute top-1 right-2 text-red-500 text-xs font-bold bg-[#111] px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
