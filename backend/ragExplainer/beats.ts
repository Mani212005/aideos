/**
 * File Description: The beat sheet for the film "RAG, in four steps": a rhythmic, lyric-style
 * explainer about retrieval-augmented generation. One beat is one spoken line and one shot. The
 * narration is the single source of truth the voiceover step and the film builder both read.
 */

/** Chapter rail labels, in order. */
export const CHAPTERS = ["the problem", "the fix", "the pipeline", "the answer", "the catch"] as const;

/** One spoken line and the scene it belongs to. */
export interface Beat {
  id: string;
  chapter: (typeof CHAPTERS)[number];
  /** Which procedural scene this line plays inside. */
  scene: "liar" | "fix" | "chunk" | "embed" | "search" | "stuff" | "ground" | "fail" | "outro";
  narration: string;
}

export const BEATS: Beat[] = [
  { id: "stale", chapter: "the problem", scene: "liar", narration: "I know so much, but I stopped learning last spring." },
  { id: "invent", chapter: "the problem", scene: "liar", narration: "Ask me about today, and I'll invent anything." },
  { id: "halluc", chapter: "the problem", scene: "liar", narration: "They call it hallucination. I call it confidence." },
  { id: "nexttoken", chapter: "the problem", scene: "liar", narration: "No source, no brakes. Just the next likely word." },
  { id: "lookup", chapter: "the fix", scene: "fix", narration: "So don't make me remember. Let me look it up." },
  { id: "title", chapter: "the fix", scene: "fix", narration: "Retrieval. Augmented. Generation." },
  { id: "tear", chapter: "the pipeline", scene: "chunk", narration: "Step one: tear your documents into chunks." },
  { id: "overlap", chapter: "the pipeline", scene: "chunk", narration: "Small pieces, with a little overlap, so no sentence gets cut." },
  { id: "sizes", chapter: "the pipeline", scene: "chunk", narration: "Too small, it loses the plot. Too big, the signal drowns." },
  { id: "vectors", chapter: "the pipeline", scene: "embed", narration: "Step two: every chunk becomes a vector, a point in space." },
  { id: "meaning", chapter: "the pipeline", scene: "embed", narration: "Meaning is just coordinates. Similar ideas land close." },
  { id: "query", chapter: "the pipeline", scene: "search", narration: "Step three: your question becomes a point too." },
  { id: "topk", chapter: "the pipeline", scene: "search", narration: "Draw rings around it. Grab the nearest few. That's top k." },
  { id: "stuff", chapter: "the answer", scene: "stuff", narration: "Step four: stuff those chunks into my prompt." },
  { id: "receipts", chapter: "the answer", scene: "stuff", narration: "Now I've got receipts before I speak." },
  { id: "shift", chapter: "the answer", scene: "ground", narration: "Watch the odds shift once the context lands." },
  { id: "grounded", chapter: "the answer", scene: "ground", narration: "The guesses fall away. The answer has a source." },
  { id: "wrong", chapter: "the catch", scene: "fail", narration: "But fetch the wrong chunk, and I'll be wrong, with citations." },
  { id: "garbage", chapter: "the catch", scene: "fail", narration: "Garbage in, confident out. Bad retrieval is the bug." },
  { id: "recap", chapter: "the catch", scene: "outro", narration: "Chunk it. Embed it. Search it. Stuff it." },
  { id: "end", chapter: "the catch", scene: "outro", narration: "Ground it. Then let the model speak." },
];

// The spoken narration only, one string per shot, in the order the pipeline synthesizes it.
export function narrationSegments(): string[] {
  return BEATS.map((beat) => beat.narration);
}
