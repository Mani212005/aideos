/**
 * File Description: Isomorphic Claude screenplay parser/serializer shared by the browser Script Editor UI
 * and the backend dev server. Turns timestamped, tag-based Claude scripts ([VISUAL]/[NARRATION]/[ON SCREEN],
 * plus legacy VO:/Voiceover:/Narrator:/VISUAL:/ON-SCREEN TEXT: conventions) into structured segments, back
 * into canonical markdown, into strictly-spoken narration text, and into Remotion sub-shots with on-screen
 * TextReveal overlays. Contains no Node-only imports so it can be bundled for the browser as-is.
 */

/** The three beat kinds a Claude screenplay segment can repeat in any order. */
export type BeatType = "visual" | "narration" | "onscreen";

/** One direction/dialogue/overlay beat inside a segment, in document order. */
export interface ScriptBeat {
  type: BeatType;
  text: string;
}

/** One timestamped scene/section of a screenplay, holding its ordered beats. */
export interface ScriptSegment {
  id: string;
  title: string;
  timeStart?: string;
  timeEnd?: string;
  beats: ScriptBeat[];
}

/** A single narration-anchored micro-shot grouped out of a segment's beats. */
interface BeatGroup {
  visual?: string;
  narration?: string;
  onscreen: string[];
}

/** A Remotion-ready text/body block generated from on-screen or visual beats. */
export interface GeneratedBlock {
  c: "TextReveal" | "Body";
  text: string;
  size?: "display" | "headline" | "subhead";
}

/** A Remotion-ready shot (possibly a sub-shot split out of a multi-beat segment). */
export interface GeneratedShot {
  id: string;
  dur: number;
  look: string;
  move: "cut" | "pan" | "zoom-in" | "zoom-out" | "hold";
  stage: "anchor" | "frame" | "none";
  zoom: number;
  drift: boolean;
  visualDirection?: string;
  metaphor?: "spider-web" | "liquid-bucket" | "balance-scale" | "clock-gears" | "rocket-launch" | "character-throw" | "glowing-cluster" | "typing-cursor-quote" | "custom";
  scriptText?: string;
  blocks: GeneratedBlock[];
}

/** A canvas node generated for one segment, used by the film's spatial graph. */
export interface GeneratedNode {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A canvas edge connecting two consecutive segment nodes. */
export interface GeneratedEdge {
  from: string;
  to: string;
  dashed: boolean;
}

/** Slugifies arbitrary text into a lowercase, hyphenated id safe for the Film schema. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strips markdown emphasis/quote markup, tags, and normalizes dashes/whitespace in beat body text. */
function cleanBeatText(text: string): string {
  return text
    .replace(/^\[?\s*(?:VISUAL(?:S|\s+DIRECTION|\s+CUE)?|NARRATION|NARRATOR|VOICEOVER|VO|ON[-\s]*SCREEN(?:\s+TEXT)?|TEXT\s+OVERLAY)\s*:\s*/i, "")
    .replace(/\]\s*$/, "")
    .replace(/["“”]/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\u2014/g, " - ")
    .replace(/\u2013/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detects a notes or fact-check section header that ends screenplay parsing. */
function isProductionNotesHeader(line: string): boolean {
  return /^#{0,4}\s*(production notes?|notes?|fact check|source notes?|sources?|references?)\b/i.test(line);
}

/** Detects a standalone closing word-count note, e.g. "*(Narration word count: ~450 words)*". */
function isWordCountNote(line: string): boolean {
  return /^\*{0,2}[\(\[](?:Narration\s*)?word count.*[\)\]]\*{0,2}$/i.test(line);
}

/** Parsed pieces of a `## [timestamp] - Title (id)` style segment header line. */
interface SegmentHeaderInfo {
  title: string;
  timeStart?: string;
  timeEnd?: string;
  explicitId?: string;
}

/** Matches a segment header line (with or without # markdown hashes) and extracts its timestamp range, title, and optional explicit id. */
function matchSegmentHeader(line: string): SegmentHeaderInfo | null {
  let headerText = line.trim();
  if (!headerText) return null;

  const hashMatch = headerText.match(/^#{1,4}\s+(.*)$/);
  if (hashMatch) {
    headerText = hashMatch[1].trim();
  } else {
    const isBareTimestamp = /^(\d{1,2}:\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}:\d{2})\b/.test(headerText);
    const isBareScene = /^(?:Scene|Shot|Segment|Act)\s+\d+\b/i.test(headerText);
    if (!isBareTimestamp && !isBareScene) return null;
  }

  let timeStart: string | undefined;
  let timeEnd: string | undefined;
  const tm = headerText.match(/^(\d{1,2}:\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}:\d{2})(.*)$/);
  if (tm) {
    timeStart = tm[1];
    timeEnd = tm[2];
    headerText = tm[3].replace(/^\s*[-\u2013\u2014:]\s*/, "").trim();
  }

  let explicitId: string | undefined;
  const idMatch = headerText.match(/\(([a-z0-9][a-z0-9-]*)\)\s*$/i);
  if (idMatch && idMatch.index !== undefined) {
    explicitId = idMatch[1].toLowerCase();
    headerText = headerText.slice(0, idMatch.index).trim();
  }

  return { title: headerText, timeStart, timeEnd, explicitId };
}

/** Matches a `[VISUAL]`, `[NARRATION]`, or `[ON SCREEN]` bracket tag, supporting inline text on the same line. */
function matchBracketTag(line: string): { type: BeatType; inline?: string } | null {
  const m = line.match(
    /^\[(VISUAL(?:S|\s+DIRECTION|\s+CUE)?|NARRATION|NARRATOR|VOICEOVER|VO|ON[-\s]*SCREEN(?:\s+TEXT)?|TEXT\s+OVERLAY)\s*(?::\s*|\s*\]\s*:?\s*|\s*\])(.*)$/i
  );
  if (!m) return null;

  const rawTag = m[1].toUpperCase().replace(/[-\s]+/g, " ");
  let type: BeatType;
  if (rawTag.startsWith("VISUAL")) {
    type = "visual";
  } else if (rawTag.startsWith("NARRATION") || rawTag.startsWith("NARRATOR") || rawTag.startsWith("VO")) {
    type = "narration";
  } else {
    type = "onscreen";
  }

  let inline = m[2] ? m[2].trim() : "";
  if (inline.endsWith("]")) {
    inline = inline.slice(0, -1).trim();
  }

  return { type, inline: inline || undefined };
}

/** Matches legacy screenplay tag conventions (VO:, Voiceover:, Narrator:, VISUAL:, ON-SCREEN TEXT:). */
function matchLegacyTag(line: string): { type: BeatType; inline?: string } | null {
  let m = line.match(/^\*{0,2}(?:VO|Voiceover|Narrator)\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.*)$/i);
  if (m) return { type: "narration", inline: m[1].trim() || undefined };

  m = line.match(/^\*{0,2}ON-SCREEN TEXT\s*:\*{0,2}\s*(.*)$/i);
  if (m) return { type: "onscreen", inline: m[1].trim() || undefined };

  m = line.match(/^\*{0,2}VISUAL\s*:\*{0,2}\s*(.*)$/i);
  if (m) return { type: "visual", inline: m[1].trim() || undefined };

  return null;
}

/** Matches legacy stage-direction prefixes (SCREEN:, GRAPHICS:, AUDIO:, SFX:) that just close the current beat. */
function isLegacyBoundaryTag(line: string): boolean {
  return /^\*{0,2}(SCREEN|GRAPHICS|AUDIO|SFX)\s*:\*{0,2}/i.test(line);
}

/**
 * Parses a raw Claude/legacy screenplay into an ordered list of segments, each holding its
 * VISUAL / NARRATION / ON SCREEN beats in document order. Roundtrips cleanly with
 * `serializeSegmentsToScript`.
 */
export function parseClaudeScript(raw: string): ScriptSegment[] {
  const lines = (raw || "").split(/\r?\n/);
  const segments: ScriptSegment[] = [];
  const usedIds = new Set<string>();

  let current: ScriptSegment | null = null;
  let currentBeatType: BeatType | null = null;
  let bodyLines: string[] = [];

  const flushBeat = () => {
    if (currentBeatType && current) {
      const text = cleanBeatText(bodyLines.join(" "));
      if (text) current.beats.push({ type: currentBeatType, text });
    }
    currentBeatType = null;
    bodyLines = [];
  };

  const flushSegment = () => {
    flushBeat();
    if (current && current.beats.length > 0) segments.push(current);
    current = null;
  };

  const openSegment = (header: SegmentHeaderInfo) => {
    flushSegment();
    let base = header.explicitId || slugify(header.title) || `segment-${segments.length + 1}`;
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}-${n}`;
      n++;
    }
    usedIds.add(id);
    current = {
      id,
      title: header.title || (header.timeStart ? `${header.timeStart}-${header.timeEnd}` : `Segment ${segments.length + 1}`),
      timeStart: header.timeStart,
      timeEnd: header.timeEnd,
      beats: [],
    };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (isProductionNotesHeader(line)) {
      flushSegment();
      break;
    }

    if (isWordCountNote(line)) {
      flushBeat();
      continue;
    }

    const header = matchSegmentHeader(line);
    if (header) {
      openSegment(header);
      continue;
    }

    if (line === "---" || line === "***") {
      flushBeat();
      continue;
    }

    if (!current) {
      if (!line || line.startsWith("#")) continue;
      openSegment({ title: "Segment 1" });
    }

    const bracket = matchBracketTag(line);
    if (bracket) {
      flushBeat();
      currentBeatType = bracket.type;
      if (bracket.inline) bodyLines.push(bracket.inline);
      continue;
    }

    const legacy = matchLegacyTag(line);
    if (legacy) {
      flushBeat();
      currentBeatType = legacy.type;
      if (legacy.inline) bodyLines.push(legacy.inline);
      continue;
    }

    if (isLegacyBoundaryTag(line)) {
      flushBeat();
      continue;
    }

    if (currentBeatType && line) {
      bodyLines.push(line);
    }
  }
  flushSegment();

  return segments;
}

/** Serializes structured segments back into canonical `[VISUAL]`/`[NARRATION]`/`[ON SCREEN]` markdown. */
export function serializeSegmentsToScript(segments: ScriptSegment[]): string {
  const lines: string[] = [];

  segments.forEach((seg, i) => {
    if (i > 0) lines.push("");

    let headerLine = "##";
    if (seg.timeStart && seg.timeEnd) {
      headerLine += ` ${seg.timeStart}-${seg.timeEnd}`;
      if (seg.title) headerLine += ` - ${seg.title}`;
    } else if (seg.title) {
      headerLine += ` ${seg.title}`;
    } else {
      headerLine += ` ${seg.id}`;
    }

    const autoId = slugify(seg.title) || seg.id;
    if (seg.id && seg.id !== autoId) headerLine += ` (${seg.id})`;

    lines.push(headerLine);
    lines.push("");

    seg.beats.forEach((beat) => {
      const tag = beat.type === "visual" ? "VISUAL" : beat.type === "narration" ? "NARRATION" : "ON SCREEN";
      lines.push(`[${tag}]`);
      lines.push(beat.text);
      lines.push("");
    });
  });

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

/** Fallback extraction for free-form prose with no recognizable screenplay tags at all. */
function legacyExtractSpokenBlocks(raw: string): string[] {
  const cleaned = (raw || "")
    .replace(/^#{1,6}\s+.*$/gm, "") // Strip markdown headers
    .replace(/^(\d{1,2}:\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}:\d{2}).*$/gm, "") // Strip timestamp headers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\u2014/g, " - ")
    .replace(/\u2013/g, " - ")
    .trim();

  return cleaned.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
}

/** True when the raw text contains at least one recognizable VISUAL/NARRATION/ON SCREEN beat. */
export function hasScreenplayTags(raw: string): boolean {
  return parseClaudeScript(raw).some((seg) => seg.beats.length > 0);
}

/**
 * Extracts strictly the spoken NARRATION dialogue from a Claude/legacy screenplay, one paragraph
 * per beat, guaranteed to contain zero VISUAL or ON SCREEN text.
 * If screenplay tags are detected, returns ONLY narration beats (never falls back to speaking visual/on-screen text).
 * Falls back to paragraph-splitting untagged prose only when zero screenplay tags exist in the document.
 */
export function extractSpokenBlocks(raw: string): string[] {
  const segments = parseClaudeScript(raw);
  const narration = segments.flatMap((seg) => seg.beats.filter((b) => b.type === "narration").map((b) => b.text));
  if (narration.length > 0) return narration;

  // If the document contains ANY screenplay tags or directions, NEVER speak the raw prose
  if (/\[(?:VISUAL|NARRATION|ON[-\s]*SCREEN)/i.test(raw) || /^\*{0,2}(?:VISUAL|ON-SCREEN TEXT|VO)\s*:/im.test(raw)) {
    return [];
  }

  return legacyExtractSpokenBlocks(raw);
}

/** Groups a segment's ordered beats into narration-anchored micro-shots (sub-shot splitting). */
function groupSegmentBeats(beats: ScriptBeat[]): BeatGroup[] {
  const groups: BeatGroup[] = [];
  let group: BeatGroup = { onscreen: [] };
  let lastVisual: string | undefined;
  let touched = false;

  for (const beat of beats) {
    if (beat.type === "visual") {
      lastVisual = beat.text;
      group.visual = beat.text;
      touched = true;
    } else if (beat.type === "onscreen") {
      group.onscreen.push(beat.text);
      touched = true;
    } else {
      if (group.narration) {
        groups.push(group);
        group = { visual: lastVisual, onscreen: [] };
      }
      group.narration = beat.text;
      touched = true;
    }
  }
  if (touched) groups.push(group);
  return groups;
}

/** Estimates shot duration from spoken word count at ~150wpm plus a natural breathing buffer. */
function estimateShotDuration(narrationText?: string): number {
  if (!narrationText) return 4;
  const words = narrationText.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 4;
  const spokenSec = (words / 150) * 60;
  const breathingBuffer = 0.5 + Math.min(0.3, words * 0.01);
  return Math.max(0.5, Math.min(90, Number((spokenSec + breathingBuffer).toFixed(2))));
}

/**
 * Compiles a raw Claude screenplay directly into Remotion-ready sub-shots, canvas nodes/edges,
 * and on-screen TextReveal overlays, splitting any multi-beat segment into alternating-move
 * micro-shots driven by narration length.
 */
export function buildFilmPartsFromScript(
  raw: string,
  targetDurationSec?: number,
): {
  shots: GeneratedShot[];
  nodes: GeneratedNode[];
  edges: GeneratedEdge[];
  spokenText: string;
  wordCount: number;
  durationSec: number;
} {
  const segments = parseClaudeScript(raw);
  const shots: GeneratedShot[] = [];
  const nodes: GeneratedNode[] = [];

  segments.forEach((seg, segIdx) => {
    const groups = groupSegmentBeats(seg.beats);
    if (groups.length === 0) return;

    nodes.push({
      id: seg.id,
      label: seg.title.slice(0, 24) || seg.id,
      sub: (groups[0].onscreen[0] || groups[0].visual || "Key concept").slice(0, 32),
      x: -200 + (segIdx % 3) * 260,
      y: -100 + Math.floor(segIdx / 3) * 180,
      w: 230,
      h: 68,
    });

    const split = groups.length > 1;
    groups.forEach((group, gi) => {
      const shotId = split ? `${seg.id}-${gi + 1}` : seg.id;
      const isVeryFirstShot = shots.length === 0;
      const move: GeneratedShot["move"] = isVeryFirstShot ? "cut" : gi % 2 === 0 ? "pan" : "zoom-out";

      const blocks: GeneratedBlock[] = [];
      group.onscreen.forEach((text) => {
        blocks.push({ c: "TextReveal", text: text.slice(0, 180), size: "headline" });
      });
      if (blocks.length === 0) {
        blocks.push({ c: "TextReveal", text: (seg.title || shotId).slice(0, 180), size: "headline" });
      }
      if (group.visual) {
        blocks.push({ c: "Body", text: group.visual.slice(0, 300) });
      }

      shots.push({
        id: shotId,
        dur: estimateShotDuration(group.narration),
        look: seg.id,
        move,
        stage: gi === 0 ? (segIdx % 2 === 1 ? "none" : "frame") : "anchor",
        zoom: 1,
        drift: true,
        visualDirection: group.visual || undefined,
        scriptText: group.narration || undefined,
        blocks: blocks.slice(0, 12),
      });
    });
  });

  if (targetDurationSec && targetDurationSec > 0 && shots.length > 0) {
    const rawTotal = shots.reduce((sum, s) => sum + s.dur, 0);
    if (rawTotal > 0) {
      const scale = targetDurationSec / rawTotal;
      shots.forEach((s) => {
        s.dur = Number((s.dur * scale).toFixed(2));
      });
      const newTotal = shots.reduce((sum, s) => sum + s.dur, 0);
      const diff = Number((targetDurationSec - newTotal).toFixed(2));
      if (Math.abs(diff) >= 0.01) {
        shots[shots.length - 1].dur = Number((shots[shots.length - 1].dur + diff).toFixed(2));
      }
    }
  }

  const edges: GeneratedEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id, dashed: false });
  }

  const spokenBlocks = extractSpokenBlocks(raw);
  const spokenText = spokenBlocks.join("\n\n");
  const wordCount = spokenText.split(/\s+/).filter(Boolean).length;
  const durationSec = targetDurationSec && targetDurationSec > 0 ? targetDurationSec : Math.round((wordCount / 150) * 60);

  return { shots, nodes, edges, spokenText, wordCount, durationSec };
}
