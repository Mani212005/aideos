import type { Film, Shot, Block } from "../../../src/dl/schema";

export function TimelineEditor({ film, onChange }: { film: Film, onChange: (f: Film) => void }) {
  const updateShot = (index: number, partial: Partial<Shot>) => {
    const shots = [...film.shots];
    shots[index] = { ...shots[index], ...partial };
    onChange({ ...film, shots });
  };

  const removeShot = (index: number) => {
    const shots = film.shots.filter((_, i) => i !== index);
    onChange({ ...film, shots });
  };

  const addShot = () => {
    const shots = [...film.shots, { id: `shot-${Date.now()}`, dur: 10, look: film.canvas.nodes[0]?.id || 'all', move: 'hold', stage: 'anchor', zoom: 1, drift: false, blocks: [] } as Shot];
    onChange({ ...film, shots });
  };

  const updateBlock = (shotIndex: number, blockIndex: number, jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText);
      const shots = [...film.shots];
      const blocks = [...shots[shotIndex].blocks];
      blocks[blockIndex] = parsed;
      shots[shotIndex] = { ...shots[shotIndex], blocks };
      onChange({ ...film, shots });
    } catch (e) {
      // ignore invalid json while typing
    }
  };

  const addBlock = (shotIndex: number) => {
    const shots = [...film.shots];
    shots[shotIndex].blocks = [...shots[shotIndex].blocks, { c: "Body", text: "New block text" } as Block];
    onChange({ ...film, shots });
  };

  const generateVoiceover = async () => {
    try {
      const res = await fetch('/api/voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ film })
      });
      if (!res.ok) {
        throw new Error(`Failed to generate voiceover: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.film) {
        onChange(data.film);
      }
    } catch (e) {
      console.error(e);
      alert('Error generating voiceover');
    }
  };

  return (
    <div className="flex flex-col gap-4 text-sm mt-4 border-t border-[#333] pt-4">
      <div className="flex justify-between items-center">
        <h2 className="font-bold">Timeline (Shots)</h2>
        <div className="flex gap-2">
          <button onClick={generateVoiceover} className="text-xs bg-[#635BFF] hover:bg-[#5249e6] px-2 py-1 rounded text-white font-medium transition-colors">
            Generate Voiceover
          </button>
          <button onClick={addShot} className="text-xs bg-[#222] px-2 py-1 rounded">Add Shot</button>
        </div>
      </div>
      {film.shots.map((shot, i) => (
        <div key={i} className="border border-[#333] p-2 rounded bg-[#1A1A1B] flex flex-col gap-2">
          <div className="flex justify-between">
            <input className="bg-transparent font-bold" value={shot.id} onChange={e => updateShot(i, { id: e.target.value })} />
            <button onClick={() => removeShot(i)} className="text-red-500">X</button>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400">Dur(s):</span>
            <input className="bg-[#222] w-12 px-1" type="number" value={shot.dur} onChange={e => updateShot(i, { dur: Number(e.target.value) })} />
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400">Look:</span>
            <input className="bg-[#222] flex-1 px-1" value={Array.isArray(shot.look) ? shot.look.join(',') : shot.look} onChange={e => updateShot(i, { look: e.target.value.includes(',') ? e.target.value.split(',') : e.target.value })} />
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400">Move:</span>
            <select className="bg-[#222] flex-1" value={shot.move} onChange={e => updateShot(i, { move: e.target.value as any })}>
              <option value="pan">pan</option>
              <option value="zoom-in">zoom-in</option>
              <option value="zoom-out">zoom-out</option>
              <option value="hold">hold</option>
              <option value="cut">cut</option>
            </select>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400">Stage:</span>
            <select className="bg-[#222] flex-1" value={shot.stage} onChange={e => updateShot(i, { stage: e.target.value as any })}>
              <option value="anchor">anchor</option>
              <option value="frame">frame</option>
              <option value="none">none</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Script (TTS):</span>
            <textarea
              className="bg-[#111] w-full px-2 py-1 text-xs text-gray-300 resize-y"
              rows={2}
              value={shot.scriptText || ''}
              onChange={e => updateShot(i, { scriptText: e.target.value })}
              placeholder="Text for Deepgram to speak..."
            />
          </div>
          
          <div className="mt-2 text-xs">
            <div className="flex justify-between text-gray-500 mb-1">
              <span>Blocks:</span>
              <button onClick={() => addBlock(i)} className="text-blue-400">+ Add</button>
            </div>
            {shot.blocks.map((block, bi) => (
              <textarea 
                key={bi} 
                className="w-full bg-[#111] p-1 font-mono text-[10px] mb-1" 
                rows={3}
                defaultValue={JSON.stringify(block, null, 2)}
                onBlur={e => updateBlock(i, bi, e.target.value)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}