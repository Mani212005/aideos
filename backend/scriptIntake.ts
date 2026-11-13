/**
 * File Description: Isomorphic Claude screenplay parser/serializer shared by the browser Script Editor UI
 * and the backend dev server. Turns timestamped, tag-based Claude scripts ([VISUAL]/[NARRATION]/[ON SCREEN],
 * plus legacy VO:/Voiceover:/Narrator:/VISUAL:/ON-SCREEN TEXT: conventions) into structured segments, back
 * into canonical markdown, into strictly-spoken narration text, and into Remotion sub-shots with on-screen
 * TextReveal overlays. Contains no Node-only imports so it can be bundled for the browser as-is.
 * Inputs and outputs: raw script text or structured ScriptData -> bidirectional parsed segments, beats, and formatted screenplay.
 * Used by: backend/pipeline/run.ts and backend/pipeline/director.ts for parsing, backend/audio.ts and the
 * Studio script-to-TTS route through assertScriptReadyForSynthesis, and editor/src/components/ScriptEditor.tsx.
 */

import {
  type AnimatedPrimitive,
  type JevDecisionState,
  type JevDecisionOptions,
  type PrimitiveSelectionResult,
  heuristicPrimitiveSelection,
  selectPrimitive,
  prefetchPrimitiveAnswers,
  resolvePrimitive,
} from "./jev";
import {
  type BeatType,
  type ScriptIssue,
  type SegmentHeaderInfo,
  SCREENPLAY_START,
  STORY_START,
  classifyScreenplayLine,
  classifyStoryLine,
  continuedFragmentIssue,
  narrationStartsWithTitle,
  stepScreenplay,
  stepStory,
} from "./screenplayLines";

/** The three beat kinds a Claude screenplay segment can repeat in any order (defined by the line classifier). */
export type { BeatType };

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
export interface BeatGroup {
  visual?: string;
  narration?: string;
  onscreen: string[];
}

/** The block type discriminator for generated shots. */
export type GeneratedBlockType = AnimatedPrimitive | "Body";

/** A Remotion-ready text/body/primitive block generated from on-screen or visual beats. */
export interface GeneratedBlock {
  c: GeneratedBlockType;
  text?: string;
  size?: "display" | "headline" | "subhead";
  accentWord?: string;
  to?: number;
  label?: string;
  format?: "plain" | "compact";
  suffix?: string;
  value?: number;
  chapters?: number;
  code?: string;
  language?: string;
  caption?: string;
  title?: string;
  body?: string;
  state?: "idle" | "active";
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
    const base = header.explicitId || slugify(header.title) || `segment-${segments.length + 1}`;
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

  let state = SCREENPLAY_START;
  for (let index = 0; index < lines.length; index++) {
    if (state.phase === "ended") break;
    const line = classifyScreenplayLine(lines[index], { next: lines[index + 1] });
    const step = stepScreenplay(state, line);
    state = step.state;
    for (const effect of step.effects) {
      if (effect === "flush-beat") flushBeat();
      else if (effect === "open-section") openSegment(line.header as SegmentHeaderInfo);
      else if (effect === "open-implicit-section") openSegment({ title: "Segment 1" });
      else if (effect === "start-beat") {
        currentBeatType = line.beat ?? null;
        if (line.inline) bodyLines.push(line.inline);
      } else if (effect === "append-line") bodyLines.push(line.text);
      else if (effect === "end") flushSegment();
    }
  }
  flushSegment();

  return segments;
}

/** The per-shot fields a film manifest carries that a screenplay can be rebuilt from. */
export interface ScreenplayShotSource {
  ch?: string;
  dur?: number;
  scriptText?: string;
  visualDirection?: string;
}

// Formats seconds as a screenplay timestamp ("m:ss").
function formatScriptTime(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// Rebuilds a screenplay from a film's shots (one segment per chapter) for a package with no script.md.
export function screenplayFromFilmShots(shots: ScreenplayShotSource[]): string {
  const segments: ScriptSegment[] = [];
  let clock = 0;
  for (const shot of shots) {
    const start = clock;
    clock += shot.dur ?? 0;
    if (!shot.scriptText?.trim()) continue;
    const title = shot.ch?.trim() || "Untitled";
    let seg = segments[segments.length - 1];
    if (!seg || seg.title !== title) {
      seg = { id: slugify(title) || `segment-${segments.length + 1}`, title, timeStart: formatScriptTime(start), beats: [] };
      segments.push(seg);
    }
    seg.timeEnd = formatScriptTime(clock);
    if (shot.visualDirection?.trim()) seg.beats.push({ type: "visual", text: shot.visualDirection.trim() });
    seg.beats.push({ type: "narration", text: shot.scriptText.trim() });
  }
  return segments.length ? serializeSegmentsToScript(segments) : "";
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
  return splitPlainStory(raw).flatMap((section) => section.paragraphs);
}

/** Extracts a short, punchy summary headline for a paragraph (2-8 words). */
function deriveHeadlineFromText(text: string, maxLength = 40): string {
  const clean = text
    .replace(/^#+\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/["“”`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const firstSentence = clean.split(/[.?!]\s+/)[0] || clean;
  if (firstSentence.length <= maxLength) return firstSentence;

  const words = firstSentence.split(/\s+/);
  let result = "";
  for (const w of words) {
    if ((result + " " + w).trim().length > maxLength) break;
    result = (result + " " + w).trim();
  }
  return result || words.slice(0, 5).join(" ");
}

/** One run of the user's story: an optional `#Tag` heading and the paragraphs that follow it. */
interface PlainStorySection {
  tag?: string;
  paragraphs: string[];
}

/** Normalizes one story paragraph for speech: links, code ticks, emphasis, quotes and long dashes go; the words stay. */
function cleanStoryParagraph(text: string): string {
  return cleanBeatText(text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`([^`]+)`/g, "$1"));
}

/**
 * Splits a plain-text story into its `#Tag` sections and blank-line paragraph groups, keeping each
 * paragraph's own words (lines of one paragraph are joined with single spaces). A paragraph that
 * follows a `#Tag` belongs to that tag's section; a paragraph with no tag is a section of its own.
 * A bare title line directly above a paragraph is a heading (the line classifier decides), so it
 * becomes that paragraph's section tag instead of being joined into the narration; each such line
 * is returned in `issues` so the caller can tell the user.
 */
function readPlainStory(raw: string): { sections: PlainStorySection[]; issues: ScriptIssue[] } {
  const sections: PlainStorySection[] = [];
  const issues: ScriptIssue[] = [];
  let tag: string | undefined;
  let lines: string[] = [];

  const flushParagraph = () => {
    const text = cleanStoryParagraph(lines.join(" "));
    lines = [];
    if (!text) return;
    const last = sections[sections.length - 1];
    if (tag !== undefined && last && last.tag === tag) last.paragraphs.push(text);
    else sections.push({ tag, paragraphs: [text] });
  };

  const rawLines = (raw || "").split(/\r?\n/);
  let phase = STORY_START;
  rawLines.forEach((rawLine, index) => {
    const line = classifyStoryLine(rawLine, { paragraphStart: phase === STORY_START, next: rawLines[index + 1] });
    const step = stepStory(phase, line);
    phase = step.phase;
    for (const effect of step.effects) {
      if (effect === "flush-paragraph") flushParagraph();
      else if (effect === "set-tag") tag = line.storyTag;
      else if (effect === "append-line") {
        lines.push(line.text);
        const issue = continuedFragmentIssue(line, index + 1);
        if (issue) issues.push(issue);
      }
      else if (effect === "report-heading") {
        issues.push({
          kind: "heading-line",
          severity: "notice",
          line: index + 1,
          text: line.text,
          message: `line ${index + 1} "${line.text}" is a chapter heading directly above its paragraph, so it is used as the section title and is not narrated or captioned`,
        });
      }
    }
  });
  flushParagraph();
  return { sections, issues };
}

/** The sections of a plain-text story; see `readPlainStory`. */
function splitPlainStory(raw: string): PlainStorySection[] {
  return readPlainStory(raw).sections;
}

/**
 * Checks a script before synthesis. A tagged screenplay whose narration begins
 * with its own section title is an error (the heading leaked into the spoken text); a plain
 * story's heading lines are reported as notices saying they became section titles instead of narration.
 */
export function checkScriptIntake(raw: string): ScriptIssue[] {
  if (!raw || !raw.trim()) return [];
  const segments = parseClaudeScript(raw);
  if (!segments.some((seg) => seg.beats.length > 0)) return readPlainStory(raw).issues;
  const issues: ScriptIssue[] = [];
  const lines = raw.split(/\r?\n/);
  let state = SCREENPLAY_START;
  for (let index = 0; index < lines.length; index++) {
    if (state.phase === "ended") break;
    const line = classifyScreenplayLine(lines[index], { next: lines[index + 1] });
    const issue = continuedFragmentIssue(line, index + 1);
    if (issue) issues.push(issue);
    state = stepScreenplay(state, line).state;
  }
  for (const seg of segments) {
    for (const beat of seg.beats) {
      if (beat.type === "narration" && narrationStartsWithTitle(seg.title, beat.text)) {
        issues.push({
          kind: "narration-starts-with-title",
          severity: "error",
          text: beat.text,
          message: `the narration of section "${seg.title}" begins with its own title, so the narrator would read the heading aloud: "${beat.text.slice(0, 60)}"; remove the title from the narration`,
        });
      }
    }
  }
  return issues;
}

/** Marks a blocking screenplay issue raised before audio synthesis begins. */
export class ScriptIntakeError extends Error {
  /** Constructs the blocking intake error shown to the script author. */
  constructor(message: string) {
    super(message);
    this.name = "ScriptIntakeError";
  }
}

/** Reports non-blocking issues, then rejects title leaks at each script-to-synthesis entry. */
export function assertScriptReadyForSynthesis(raw: string, onNotice?: (issue: ScriptIssue) => void): ScriptIssue[] {
  const issues = checkScriptIntake(raw);
  const notices = issues.filter((issue) => issue.severity === "notice");
  for (const issue of notices) onNotice?.(issue);
  const blocking = issues.filter((issue) => issue.severity === "error");
  if (blocking.length) throw new ScriptIntakeError(blocking.map((issue) => issue.message).join("; "));
  return notices;
}

/**
 * Deterministically turns a user's plain-text story (paragraphs plus `#Start` / `#Conclusion` style
 * markers) into the internal segments, with no agent involved. Each `#Tag` opens a section holding
 * its paragraphs, each untagged paragraph is a section of its own, every paragraph becomes one
 * NARRATION beat with the user's words, and its VISUAL and ON SCREEN slots start empty for the
 * agent to fill. Timestamps are estimated from word counts at the chosen voice speed.
 */
export function plainTextToSegments(raw: string, options?: { speed?: number }): ScriptSegment[] {
  const speed = options?.speed ?? 1;
  const usedIds = new Set<string>();
  const segments: ScriptSegment[] = [];
  let clock = 0;

  splitPlainStory(raw).forEach((section, idx) => {
    const title = section.tag || deriveHeadlineFromText(section.paragraphs[0], 36) || `Part ${idx + 1}`;
    const base = slugify(title) || `part-${idx + 1}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);

    const start = clock;
    const beats: ScriptBeat[] = [];
    for (const paragraph of section.paragraphs) {
      clock += estimateNarrationSeconds(paragraph, speed);
      beats.push({ type: "visual", text: "" }, { type: "onscreen", text: "" }, { type: "narration", text: paragraph });
    }
    segments.push({ id, title, timeStart: formatScriptTime(start), timeEnd: formatScriptTime(Math.max(clock, start + 1)), beats });
  });

  return segments;
}

/** Drops the empty VISUAL / ON SCREEN slots from segments, the way parsing the serialized script would. */
function withoutEmptyBeats(segments: ScriptSegment[]): ScriptSegment[] {
  return segments.map((seg) => ({ ...seg, beats: seg.beats.filter((beat) => beat.text.trim()) }));
}

/**
 * The one entry point from what the user wrote to the internal tagged script. A script that already
 * carries tags (or is blank) comes back byte for byte, so converting twice or converting a tagged
 * script changes nothing; a plain-text story is converted by `plainTextToSegments`.
 */
export function plainTextToTaggedScript(raw: string, options?: { speed?: number }): string {
  if (!raw || !raw.trim() || hasScreenplayTags(raw)) return raw;
  const segments = plainTextToSegments(raw, options);
  return segments.length > 0 ? serializeSegmentsToScript(segments) : raw;
}

/** Deterministically structures untagged prose paragraphs into Claude screenplay segments. */
export function structureUntaggedProseToScript(raw: string): ScriptSegment[] {
  const paragraphs = legacyExtractSpokenBlocks(raw);
  if (paragraphs.length === 0) return [];

  const segments: ScriptSegment[] = [];
  const usedIds = new Set<string>();

  paragraphs.forEach((para, idx) => {
    const headline = deriveHeadlineFromText(para, 36) || `Scene ${idx + 1}`;
    const base = slugify(headline) || `scene-${idx + 1}`;
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}-${n}`;
      n++;
    }
    usedIds.add(id);

    const onScreen = deriveHeadlineFromText(para, 44) || headline;
    const visual = `Conceptual diagram and typographic presentation for ${headline.toLowerCase()}.`;

    segments.push({
      id,
      title: `Scene ${idx + 1}: ${headline}`,
      beats: [
        { type: "visual", text: visual },
        { type: "onscreen", text: onScreen },
        { type: "narration", text: para },
      ],
    });
  });

  return segments;
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

/** Identifies which spoken narration beats mark the beginning of a new chapter in a Claude screenplay. */
export function detectChapterStartsFromScript(raw: string): boolean[] {
  const trimmed = (raw || "").trim();
  if (!trimmed || !hasScreenplayTags(trimmed)) {
    return [];
  }
  const sections = parseClaudeScript(trimmed);
  const beats: Array<{ sectionIndex: number; text: string }> = [];
  sections.forEach((section, sectionIndex) => {
    for (const beat of section.beats) {
      if (beat.type === "narration" && beat.text.trim()) {
        beats.push({ sectionIndex, text: beat.text.trim() });
      }
    }
  });

  if (beats.length === 0) {
    return [];
  }

  const MAX_CHAPTERS = 12;
  const usedSections = [...new Set(beats.map((b) => b.sectionIndex))].sort((a, b) => a - b);
  if (usedSections.length <= 1) {
    return new Array(beats.length).fill(false);
  }

  const chapterIndexBySection = new Map<number, number>();
  if (usedSections.length <= MAX_CHAPTERS) {
    usedSections.forEach((sIdx, i) => chapterIndexBySection.set(sIdx, i));
  } else {
    usedSections.forEach((sIdx, i) => {
      const cIdx = Math.min(MAX_CHAPTERS - 1, Math.floor((i * MAX_CHAPTERS) / usedSections.length));
      chapterIndexBySection.set(sIdx, cIdx);
    });
  }

  let lastChapterIdx = -1;
  return beats.map((b, i) => {
    const chapterIdx = chapterIndexBySection.get(b.sectionIndex) ?? 0;
    const isStart = i === 0 || chapterIdx !== lastChapterIdx;
    lastChapterIdx = chapterIdx;
    return isStart;
  });
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

/** Spoken pace the duration estimates assume at voice speed 1. */
const SPOKEN_WORDS_PER_MINUTE = 150;

/**
 * Estimates how long a narration line takes to say, from its word count, the chosen voice speed
 * (1 is normal, below 1 is slower) and a natural breathing buffer. Pure, so the studio, the pipeline
 * and the tests all agree on one number before any audio exists.
 */
export function estimateNarrationSeconds(narrationText: string, speed = 1): number {
  const words = narrationText.split(/\s+/).filter(Boolean).length;
  const pace = Math.min(2, Math.max(0.5, Number.isFinite(speed) && speed > 0 ? speed : 1));
  const spokenSec = (words / (SPOKEN_WORDS_PER_MINUTE * pace)) * 60;
  const breathingBuffer = 0.5 + Math.min(0.3, words * 0.01);
  return Math.max(0.5, Math.min(90, Number((spokenSec + breathingBuffer).toFixed(2))));
}

/** Estimates shot duration from spoken word count at ~150wpm plus a natural breathing buffer. */
function estimateShotDuration(narrationText?: string): number {
  if (!narrationText) return 4;
  if (narrationText.split(/\s+/).filter(Boolean).length === 0) return 4;
  return estimateNarrationSeconds(narrationText);
}

// Builds conforming GeneratedBlock structures for a given animated primitive and beat group.
export function buildBlocksForPrimitive(
  primitive: AnimatedPrimitive,
  group: BeatGroup,
  fallbackTitle?: string,
): GeneratedBlock[] {
  const primaryText = (group.onscreen[0] || fallbackTitle || "Key concept").slice(0, 180);
  const secondaryText = group.onscreen.slice(1).join(" ") || group.visual;

  switch (primitive) {
    case "TextReveal": {
      const blocks: GeneratedBlock[] = [];
      if (group.onscreen.length > 0) {
        group.onscreen.forEach((text) => {
          blocks.push({ c: "TextReveal", text: text.slice(0, 180), size: "headline" });
        });
      } else {
        blocks.push({ c: "TextReveal", text: primaryText, size: "headline" });
      }
      return blocks;
    }
    case "StatCounter": {
      const searchTarget = `${group.narration || ""} ${group.onscreen.join(" ")}`;
      const match = searchTarget.match(
        /\b(\d+(?:\.\d+)?)\s*(%|percent\b|x\b|times\b|ms\b|fps\b|gb\b|mb\b|tb\b|k\b|m\b|b\b|billion\b|million\b|trillion\b)?/i,
      );
      // No number in the beat means no counter: the beat keeps its text rather than a made-up 100.
      if (!match || !match[1]) return buildBlocksForPrimitive("TextReveal", group, fallbackTitle);
      const val = parseFloat(match[1]);
      const rawSuffix = match[2] ? (match[2].toLowerCase() === "times" ? "x" : match[2]) : undefined;
      const label = (group.onscreen[0] || fallbackTitle || "Key Metric").slice(0, 44);
      return [
        {
          c: "StatCounter",
          text: label,
          to: val,
          label,
          format: val >= 1000 ? "compact" : "plain",
          ...(rawSuffix ? { suffix: rawSuffix } : {}),
        },
      ];
    }
    case "CodeBlock": {
      const fullText = `${group.onscreen.join("\n")}\n${group.visual || ""}`;
      const codeMatch = fullText.match(/`([^`]+)`/);
      // Only code the script actually writes is shown; there is no stand-in snippet.
      if (!codeMatch) return buildBlocksForPrimitive("TextReveal", group, fallbackTitle);
      const code = codeMatch[1].slice(0, 300);
      const caption = (group.onscreen[0] || fallbackTitle || "Snippet").slice(0, 60);
      return [
        {
          c: "CodeBlock",
          text: code,
          code,
          caption,
        },
      ];
    }
    case "Card": {
      const title = (group.onscreen[0] || fallbackTitle || "Overview").slice(0, 30);
      const body = secondaryText ? secondaryText.slice(0, 80) : undefined;
      return [
        {
          c: "Card",
          text: title,
          title,
          ...(body ? { body } : {}),
          state: "idle",
        },
      ];
    }
    case "Divider": {
      const blocks: GeneratedBlock[] = [{ c: "Divider", text: "" }];
      if (primaryText) {
        blocks.push({ c: "TextReveal", text: primaryText, size: "headline" });
      }
      return blocks;
    }
    case "IconLabel": {
      const text = (group.onscreen[0] || fallbackTitle || "Status").slice(0, 60);
      return [
        {
          c: "IconLabel",
          text,
        },
      ];
    }
    case "ProgressBar": {
      const label = (group.onscreen[0] || fallbackTitle || "Progress").slice(0, 44);
      // The fill is a percentage the beat says; with none, the bar is not drawn (no canned 75%).
      const pct = /\b(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)/i.exec(`${group.narration || ""} ${group.onscreen.join(" ")}`);
      if (!pct || Number(pct[1]) > 100) return buildBlocksForPrimitive("TextReveal", group, fallbackTitle);
      return [
        {
          c: "ProgressBar",
          text: label,
          value: Number(pct[1]) / 100,
          label,
        },
      ];
    }
  }
}

// Selects animated primitives for all beat groups across segments using Jev with state tracking.
export async function selectScenePrimitives(
  segments: ScriptSegment[],
  options?: JevDecisionOptions,
): Promise<Map<string, PrimitiveSelectionResult>> {
  const results = new Map<string, PrimitiveSelectionResult>();
  const activeComponents: string[] = [];

  // Every group is asked about in one batched Jev request; each answer is then gated against
  // the group's live state (including the components already on screen) in order.
  const groupsBySegment = segments.map((seg) => groupSegmentBeats(seg.beats));
  // The camera is the move the compile below gives that shot: a cut to open, then alternating pan and zoom-out.
  const flatStates: JevDecisionState[] = segments.flatMap((seg, segIdx) =>
    groupsBySegment[segIdx].map((group, gi) => ({
      visual: group.visual,
      narration: group.narration,
      onscreen: group.onscreen,
      sceneTitle: seg.title,
      camera: segIdx === 0 && gi === 0 ? "cut" : gi % 2 === 0 ? "pan" : "zoom-out",
    })),
  );
  const prefetched = await prefetchPrimitiveAnswers(flatStates, options);
  let flatIndex = 0;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    const groups = groupsBySegment[segIdx];
    const split = groups.length > 1;

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const shotId = split ? `${seg.id}-${gi + 1}` : seg.id;

      const state: JevDecisionState = {
        visual: group.visual,
        narration: group.narration,
        onscreen: group.onscreen,
        activeComponents: [...activeComponents],
        sceneTitle: seg.title,
        camera: flatStates[flatIndex].camera,
        ...(activeComponents.length ? { previousPick: activeComponents[activeComponents.length - 1] } : {}),
      };

      const decision = prefetched
        ? resolvePrimitive(prefetched[flatIndex], state, options)
        : await selectPrimitive(state, options);
      flatIndex += 1;
      results.set(shotId, decision);

      activeComponents.push(decision.primitive);
      if (activeComponents.length > 8) {
        activeComponents.shift();
      }
    }
  }

  return results;
}

/**
 * Compiles a raw Claude screenplay directly into Remotion-ready sub-shots, canvas nodes/edges,
 * and on-screen TextReveal overlays, splitting any multi-beat segment into alternating-move
 * micro-shots driven by narration length.
 */
export function buildFilmPartsFromScript(
  raw: string,
  targetDurationSec?: number,
  options?: { usePrimitives?: boolean },
): {
  shots: GeneratedShot[];
  nodes: GeneratedNode[];
  edges: GeneratedEdge[];
  spokenText: string;
  wordCount: number;
  durationSec: number;
} {
  let segments = parseClaudeScript(raw);
  if (segments.length === 0 && raw && raw.trim()) {
    segments = withoutEmptyBeats(plainTextToSegments(raw));
  }
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

      let blocks: GeneratedBlock[];
      if (options?.usePrimitives) {
        const state: JevDecisionState = {
          visual: group.visual,
          narration: group.narration,
          onscreen: group.onscreen,
          sceneTitle: seg.title,
        };
        const primitive = heuristicPrimitiveSelection(state);
        blocks = buildBlocksForPrimitive(primitive, group, seg.title || shotId);
      } else {
        blocks = [];
        group.onscreen.forEach((text) => {
          blocks.push({ c: "TextReveal", text: text.slice(0, 180), size: "headline" });
        });
        if (blocks.length === 0) {
          blocks.push({ c: "TextReveal", text: (seg.title || shotId).slice(0, 180), size: "headline" });
        }
      }

      // A [VISUAL] beat is a direction to the renderer, not copy for the viewer. It travels
      // on the shot's visualDirection field instead.
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

// Compiles a raw Claude screenplay directly into Remotion-ready parts asynchronously using Jev for intelligent primitive selection.
export async function buildFilmPartsFromScriptAsync(
  raw: string,
  targetDurationSec?: number,
  options?: JevDecisionOptions,
): Promise<{
  shots: GeneratedShot[];
  nodes: GeneratedNode[];
  edges: GeneratedEdge[];
  spokenText: string;
  wordCount: number;
  durationSec: number;
  decisions: Map<string, PrimitiveSelectionResult>;
}> {
  let segments = parseClaudeScript(raw);
  if (segments.length === 0 && raw && raw.trim()) {
    segments = withoutEmptyBeats(plainTextToSegments(raw));
  }
  const decisions = await selectScenePrimitives(segments, options);
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

      const decision = decisions.get(shotId);
      const primitive = decision ? decision.primitive : "TextReveal";
      const blocks = buildBlocksForPrimitive(primitive, group, seg.title || shotId);

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
  const durationSec =
    targetDurationSec && targetDurationSec > 0 ? targetDurationSec : Math.round((wordCount / 150) * 60);

  return { shots, nodes, edges, spokenText, wordCount, durationSec, decisions };
}

/**
 * What every agent-facing prompt says about the user's script, in one place so no instruction can drift back
 * to asking for a reformat. The user's story is already converted (deterministically, by Aideos) before any
 * agent is involved, and the voice-over is stored per line.
 */
export const STORY_SCRIPT_RULES =
  "The script is the user's own story, already converted by Aideos into the internal tagged structure (one NARRATION line per paragraph, empty VISUAL and ON SCREEN slots). " +
  "Fill only the VISUAL and ON SCREEN slots. Keep the user's narration as it is: it needs no reformatting, restructuring or retagging, and its voice-over must not be regenerated. " +
  "You may edit or write narration when asked, including the whole script from a topic or an empty project; every narration change is recorded in the visible change list, and only the lines you changed are re-recorded.";

export interface DirectorTaskOptions {
  projectId: string;
  filmTitle?: string;
  shotCount?: number;
  durationSec?: number;
  spokenWordCount?: number;
}

/** Generates a copy-pasteable directing prompt for terminal coding agents (Claude Code, AGY, Pi, Codex). */
export function generateAgentPrompt(opts: DirectorTaskOptions): string {
  const title = opts.filmTitle || opts.projectId;
  return `Direct the explainer video for "${title}" (${opts.projectId}):
1. **Look task first:** read videos/${opts.projectId}/design/LOOK_BRIEF.md, docs/DIRECTOR_GUIDE.md, the screenplay and film. Write design/look.json and run \`aideos look check ${opts.projectId}\` until PASS.
2. **Design task second:** read design/LOOK.md and design/BRIEF.md, then author design/design.json and its SVG artwork to follow the checked treatment and cast on one persistent scene stage.
3. Run \`aideos design build ${opts.projectId}\`, then \`npm run validate:film videos/${opts.projectId}/film.json\` until both pass.
4. ${STORY_SCRIPT_RULES}`;
}

/** Formats a full markdown directive task document to be written to videos/<id>/director_task.md and root .aideos_task.md */
export function generateDirectorTaskDocument(opts: DirectorTaskOptions): string {
  const title = opts.filmTitle || opts.projectId;
  const shots = opts.shotCount ?? 0;
  const duration = opts.durationSec ? `${opts.durationSec.toFixed(1)}s` : "measured";
  const words = opts.spokenWordCount ?? 0;

  return `# 🎬 Aideos Creative Director Directive: ${title}

The screenplay narration spine for **${title}** has been compiled (${shots} shots, ${duration} runtime, ${words} spoken words).
As the Creative Director, your mission is to transform this structure into a captivating, visually stunning explainer video.

---

## 📋 Key Files & References:
- **Director Guide**: [\`docs/DIRECTOR_GUIDE.md\`](docs/DIRECTOR_GUIDE.md) (Directing principles, visual rhythm, and pacing invariants)
- **Active Film JSON**: [\`videos/${opts.projectId}/film.json\`](videos/${opts.projectId}/film.json)
- **Screenplay / Narration**: [\`videos/${opts.projectId}/script.md\`](videos/${opts.projectId}/script.md)

---

## 🎯 Directing Objectives:
1. **Look task, then design task**:
   - Read \`videos/${opts.projectId}/design/LOOK_BRIEF.md\`, then write \`design/look.json\` and run
     \`aideos look check ${opts.projectId}\` until PASS before creating any picture assets.
   - Read the generated \`design/LOOK.md\` and \`design/BRIEF.md\`; make \`design/design.json\` and
     artwork follow the checked shot treatments and cast on one persistent scene stage.
2. **Camera Rhythm & Spatial Flow**:
   - Use slow, purposeful \`pan\`, \`zoom-in\`, and \`zoom-out\` moves across the persistent stage.
3. **Pacing Invariants**:
   - Keep the stage visible and evolving; device treatments are secondary to the stage.
   - Maintain audio sync (shot durations lock to narration audio).
4. **The script**: ${STORY_SCRIPT_RULES}

---

## 🧪 Validation & Live Studio:
- **Instant Validation**:
  \`\`\`bash
  npm run validate:film videos/${opts.projectId}/film.json
  \`\`\`
- **Live Studio Preview**:
  Check hot-reloaded canvas and timeline on \`http://localhost:3001\`
`;
}
