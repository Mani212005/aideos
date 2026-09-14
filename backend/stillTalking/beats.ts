/**
 * File Description: The beat sheet for the film "Still Talking" (Voyager 1).
 * One entry per shot, in order, holding the spoken narration that drives the audio-first pipeline,
 * the chapter the shot belongs to, and the on-screen blocks that overlay the SVG scene. This is the
 * single source of truth the voiceover producer and the film builder both read, so the narration
 * that is spoken and the narration recorded in the manifest can never drift apart.
 */

import type { Block } from "../../src/dl/schema";

/** One shot of the film: what is said, what is drawn over it, and where it sits in the arc. */
export interface Beat {
  /** Shot id. Lowercase letters, digits and dashes, matching the film schema. */
  id: string;
  /** Chapter title this shot belongs to. A change of chapter becomes a `cut`. */
  chapter: string;
  /** The words actually spoken over this shot. */
  narration: string;
  /**
   * Blocks drawn over the scene. An empty list makes the shot a pure-film moment
   * (schema stage "none"), which is also what returns the runsheet to the canvas.
   */
  blocks: Block[];
}

/** The six chapters of the film, in order. Derived from the beat sheet, never authored twice. */
export const CHAPTERS = [
  "departure",
  "the grand tour",
  "out of the plane",
  "pale blue dot",
  "the edge",
  "still talking",
] as const;

export const BEATS: Beat[] = [
  {
    id: "departure",
    chapter: "departure",
    narration:
      "In September of nineteen seventy seven, a machine about the size of a small car was bolted to the top of a rocket and pointed away from everything it had ever known.",
    blocks: [{ c: "TextReveal", text: "Still Talking", size: "display", accentWord: "Talking" }],
  },
  {
    id: "one-job",
    chapter: "departure",
    narration: "It had one job. Fly past the outer planets, take pictures, and send them home.",
    blocks: [],
  },
  {
    id: "not-coming-back",
    chapter: "departure",
    narration:
      "It was never coming back. The people who built it knew that. They packed it a lunch anyway.",
    blocks: [],
  },
  {
    id: "the-record",
    chapter: "departure",
    narration:
      "Bolted to its side, a gold plated record. Greetings in fifty five languages. Whale song. Photographs of the world it was leaving. And instructions, etched into the cover, for anyone who might one day find it.",
    blocks: [],
  },
  {
    id: "let-go",
    chapter: "departure",
    narration: "Then they let it go.",
    blocks: [],
  },
  {
    id: "falling-outward",
    chapter: "the grand tour",
    narration:
      "For eighteen months it fell outward through the dark, a small bright point, talking the whole way.",
    blocks: [],
  },
  {
    id: "jupiter",
    chapter: "the grand tour",
    narration:
      "In March of nineteen seventy nine, Jupiter filled its cameras. A storm wider than the Earth, slowly turning.",
    blocks: [{ c: "TextReveal", text: "March 1979 - Jupiter", size: "subhead" }],
  },
  {
    id: "slingshot",
    chapter: "the grand tour",
    narration: "It stole a little speed from the giant as it went past. The giant never noticed.",
    blocks: [],
  },
  {
    id: "saturn",
    chapter: "the grand tour",
    narration:
      "Twenty months later, Saturn. It swung in close to the moon Titan to look for an atmosphere, and found one.",
    blocks: [{ c: "TextReveal", text: "November 1980 - Saturn and Titan", size: "subhead" }],
  },
  {
    id: "out-of-plane",
    chapter: "out of the plane",
    narration:
      "That choice cost it the rest of the tour. Titan bent its path up and out of the flat plane the planets travel in.",
    blocks: [],
  },
  {
    id: "nothing-but-distance",
    chapter: "out of the plane",
    narration: "There was nothing ahead of it any more. Nothing but distance.",
    blocks: [],
  },
  {
    id: "turn-around",
    chapter: "pale blue dot",
    narration:
      "Thirteen years after launch, out past the orbit of Neptune, it was asked to turn around one last time.",
    blocks: [],
  },
  {
    id: "sixty-photographs",
    chapter: "pale blue dot",
    narration: "It aimed its cameras back the way it had come and took sixty photographs of home.",
    blocks: [],
  },
  {
    id: "pale-blue-pixel",
    chapter: "pale blue dot",
    narration:
      "In one of them, caught by accident in a stray beam of sunlight, there is a single pale blue pixel.",
    blocks: [{ c: "TextReveal", text: "Six billion kilometres from home", size: "subhead" }],
  },
  {
    id: "that-is-everyone",
    chapter: "pale blue dot",
    narration:
      "That is everyone. Every war, every love letter, every person who has ever lived, on one speck of dust suspended in a sunbeam.",
    blocks: [],
  },
  {
    id: "eyes-closed",
    chapter: "pale blue dot",
    narration: "Then the cameras went off for good, to save power, and it kept going.",
    blocks: [],
  },
  {
    id: "particles-change",
    chapter: "the edge",
    narration: "On the twenty fifth of August, twenty twelve, the particles around it changed.",
    blocks: [{ c: "TextReveal", text: "25 August 2012 - the heliopause", size: "subhead" }],
  },
  {
    id: "last-breath",
    chapter: "the edge",
    narration:
      "The solar wind, the thin breath our sun has been exhaling for four and a half billion years, simply stopped.",
    blocks: [],
  },
  {
    id: "across-the-edge",
    chapter: "the edge",
    narration:
      "It had crossed the edge. The first thing we ever made to leave the sun behind entirely.",
    blocks: [],
  },
  {
    id: "still-out-there",
    chapter: "still talking",
    narration: "It is still out there. Still talking.",
    blocks: [],
  },
  {
    id: "twenty-two-watts",
    chapter: "still talking",
    narration:
      "Its voice is twenty two watts, about the same as the light in a fridge. By the time that whisper reaches the dishes in the desert, it is fainter than almost anything we know how to hear.",
    blocks: [{ c: "StatCounter", to: 22, label: "transmitter power", format: "plain", suffix: " watts" }],
  },
  {
    id: "going-dark",
    chapter: "still talking",
    narration:
      "Every year it gets a little colder. Instruments shut down one by one to keep the radio alive.",
    blocks: [],
  },
  {
    id: "the-last-one",
    chapter: "still talking",
    narration:
      "Some time in the thirties, the last of them will go quiet, and it will stop answering.",
    blocks: [],
  },
  {
    id: "keep-going",
    chapter: "still talking",
    narration:
      "And then it will simply keep going, in the dark, carrying its record, for a very long time.",
    blocks: [{ c: "TextReveal", text: "Voyager 1", size: "display" }],
  },
  {
    id: "longer-than-the-sun",
    chapter: "still talking",
    narration: "Long enough that the sun will die first.",
    blocks: [{ c: "TextReveal", text: "Launched 1977. Still transmitting.", size: "subhead", accentWord: "transmitting" }],
  },
];

/** The spoken narration only, one string per shot, in the order the pipeline synthesizes it. */
export function narrationSegments(): string[] {
  return BEATS.map((beat) => beat.narration);
}

/** Total spoken word count, used to keep the film honest about its own length. */
export function spokenWordCount(): number {
  return BEATS.reduce((sum, beat) => sum + beat.narration.split(/\s+/).filter(Boolean).length, 0);
}
