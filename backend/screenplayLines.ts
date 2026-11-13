/**
 * File Description: The explicit screenplay line classifier machine. Every line of a script is given exactly one
 * class (blank, marker, timestamp, heading, tag, note, prose) and two transition tables (one for tagged screenplays,
 * one for plain-text stories) say what each class does in each state. Pure and isomorphic: no I/O, no Node imports,
 * so the browser editor, the pipeline and the tests all read a script through the same machine.
 * Inputs and outputs: one script line plus its context -> a ClassifiedLine; a state plus a ClassifiedLine -> the next
 * state and the effects the caller applies; an impossible (state, class) pair throws ImpossibleTransitionError.
 * Used by: backend/scriptIntake.ts (parseClaudeScript, splitPlainStory, checkScriptIntake).
 */

/** The three beat kinds a Claude screenplay segment can repeat in any order. */
export type BeatType = "visual" | "narration" | "onscreen";

/** The one class every script line receives. */
export type LineClass = "blank" | "marker" | "timestamp" | "heading" | "tag" | "note" | "prose";

/** Parsed pieces of a `## [timestamp] - Title (id)` style segment header line. */
export interface SegmentHeaderInfo {
  title: string;
  timeStart?: string;
  timeEnd?: string;
  explicitId?: string;
}

/** What kind of non-content line a `note` is. */
export type NoteKind = "production-notes" | "word-count" | "rule" | "stage-direction";

/** A line after classification: its class plus whatever the class carries. */
export interface ClassifiedLine {
  cls: LineClass;
  /** The trimmed line text. */
  text: string;
  /** marker / timestamp / heading in a screenplay: the parsed section header. */
  header?: SegmentHeaderInfo;
  /** marker in a story: the section tag text (`#Start` gives "Start"). */
  storyTag?: string;
  /** tag: which beat it opens and any text written on the same line. */
  beat?: BeatType;
  inline?: string;
  /** note: which kind. */
  note?: NoteKind;
  /** prose: true when the line starts with `#` but is not a section header or story tag. */
  hashed?: boolean;
}

/** Which grammar a script is read with. */
export type Dialect = "screenplay" | "story";

/** What the caller knows about a line's surroundings, so classification stays a pure function. */
export interface LineContext {
  /** Story only: no paragraph is open, so this line would start one. */
  paragraphStart?: boolean;
  /** Story only: the raw line that follows, if any. */
  next?: string;
}

/** Thrown when a (state, class) pair has no row in the transition table. */
export class ImpossibleTransitionError extends Error {
  readonly state: string;
  readonly cls: LineClass;

  constructor(dialect: Dialect, state: string, cls: LineClass) {
    super(`impossible ${dialect} transition: a ${cls} line cannot occur in state ${state}`);
    this.name = "ImpossibleTransitionError";
    this.state = state;
    this.cls = cls;
  }
}

/** Detects a notes or fact-check section header that ends screenplay parsing. */
function isProductionNotesHeader(line: string): boolean {
  return /^#{1,4}\s+(production notes?|notes?|fact check|source notes?|sources?|references?)\b/i.test(line) ||
    /^\*\*(production notes?|notes?|fact check|source notes?|sources?|references?)\*\*/i.test(line);
}

/** Detects a standalone closing word-count note, e.g. "*(Narration word count: ~450 words)*". */
function isWordCountNote(line: string): boolean {
  return /^\*{0,2}[([\\(]?(?:Narration\s*)?word count.*[)\\]]?\*{0,2}$/i.test(line);
}

/** Matches a segment header line (with or without # hashes) and extracts its timestamp range, title, and optional explicit id. */
function matchSegmentHeader(line: string): (SegmentHeaderInfo & { hashed: boolean; bareScene: boolean }) | null {
  let headerText = line.trim();
  if (!headerText) return null;

  let hashed = false;
  let bareScene = false;
  const hashMatch = headerText.match(/^#{1,4}\s+(.*)$/);
  if (hashMatch) {
    hashed = true;
    headerText = hashMatch[1].trim();
  } else {
    const isBareTimestamp = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\b/.test(headerText);
    bareScene = /^(?:Scene|Shot|Segment|Act)\s+\d+\b/i.test(headerText);
    if (!isBareTimestamp && !bareScene) return null;
  }

  let timeStart: string | undefined;
  let timeEnd: string | undefined;
  const tm = headerText.match(/^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})(.*)$/);
  if (tm) {
    timeStart = tm[1];
    timeEnd = tm[2];
    headerText = tm[3].replace(/^\s*[-–—:]\s*/, "").trim();
  }

  let explicitId: string | undefined;
  const idMatch = headerText.match(/\(([a-z0-9][a-z0-9-]*)\)\s*$/i);
  if (idMatch && idMatch.index !== undefined) {
    explicitId = idMatch[1].toLowerCase();
    headerText = headerText.slice(0, idMatch.index).trim();
  }

  return { title: headerText, timeStart, timeEnd, explicitId, hashed, bareScene };
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

/** Matches a `#Start` / `# Conclusion` style section marker in a plain-text story. */
function matchStoryTag(line: string): string | null {
  // "#1 reason" is a sentence that starts with a hashtag-style number, not a section marker.
  const m = line.match(/^#{1,6}(?!\d)\s*(\S.*)$/) ?? line.match(/^#{1,6}\s+(\d.*)$/);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** Matches a bare `m:ss - m:ss` timestamp range at the start of a story line. */
function isStoryTimestamp(line: string): boolean {
  return /^\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(line);
}

/** Words that may stay lower case inside a title-cased heading. */
const TITLE_SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);

/** The longest a bare heading line can be (words, then characters) before it is read as a sentence. */
const HEADING_MAX_WORDS = 6;
const HEADING_MAX_CHARS = 48;

/** True when a bare story line looks like a chapter title: short, title cased, with no sentence-ending punctuation. */
export function looksLikeHeading(text: string): boolean {
  const line = text.trim();
  if (!line || line.length > HEADING_MAX_CHARS) return false;
  if (/[.!?:;,…"'”’)\]]$/.test(line)) return false;
  if (/^[-*+>\d]/.test(line) && !/^\d+\s+[A-Za-z]/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length > HEADING_MAX_WORDS) return false;
  return words.every((word, i) => {
    const first = word[0];
    const capitalised = first !== undefined && (first !== first.toLowerCase() || /\d/.test(first));
    return capitalised || (i > 0 && TITLE_SMALL_WORDS.has(word.toLowerCase()));
  });
}

/** Gives one screenplay line exactly one class, testing in the fixed order the parser always used. */
export function classifyScreenplayLine(rawLine: string): ClassifiedLine {
  const text = rawLine.trim();
  if (!text) return { cls: "blank", text };
  if (isProductionNotesHeader(text)) return { cls: "note", text, note: "production-notes" };
  if (isWordCountNote(text)) return { cls: "note", text, note: "word-count" };

  const header = matchSegmentHeader(text);
  if (header) {
    const { hashed, bareScene, ...info } = header;
    return { cls: hashed ? "marker" : bareScene ? "heading" : "timestamp", text, header: info };
  }

  if (text === "---" || text === "***" || text.startsWith("```")) return { cls: "note", text, note: "rule" };

  const bracket = matchBracketTag(text) ?? matchLegacyTag(text);
  if (bracket) return { cls: "tag", text, beat: bracket.type, inline: bracket.inline };

  if (isLegacyBoundaryTag(text)) return { cls: "note", text, note: "stage-direction" };
  return { cls: "prose", text, hashed: text.startsWith("#") };
}

/** Gives one plain-story line exactly one class; a bare title directly above prose is a heading, not narration. */
export function classifyStoryLine(rawLine: string, ctx: LineContext = {}): ClassifiedLine {
  const text = rawLine.trim();
  if (!text) return { cls: "blank", text };
  if (isStoryTimestamp(text)) return { cls: "timestamp", text };
  const storyTag = matchStoryTag(text);
  if (storyTag !== null) return { cls: "marker", text, storyTag };
  if (ctx.paragraphStart && looksLikeHeading(text)) {
    const next = (ctx.next ?? "").trim();
    if (next && !isStoryTimestamp(next) && matchStoryTag(next) === null) return { cls: "heading", text, storyTag: text.replace(/\s+/g, " ") };
  }
  return { cls: "prose", text };
}

/** Where the screenplay reader is: before any section, inside one, inside a beat, or past a notes header. */
export type ScreenplayPhase = "outside" | "section" | "beat" | "ended";

/** The screenplay reader's state: its phase plus the open beat's kind while in one. */
export interface ScreenplayState {
  phase: ScreenplayPhase;
  beat?: BeatType;
}

/** What the caller must do for a screenplay line, in order. */
export type ScreenplayEffect = "open-section" | "open-implicit-section" | "flush-beat" | "start-beat" | "append-line" | "end";

/** One row of a transition table: the effects to apply and the phase to land in. */
interface ScreenplayRow {
  to: ScreenplayPhase;
  effects: ScreenplayEffect[];
}

/** The screenplay transition table: (phase, class) -> row. A missing row is an impossible transition. */
const SCREENPLAY_TABLE: Record<ScreenplayPhase, Partial<Record<LineClass, ScreenplayRow | ((line: ClassifiedLine) => ScreenplayRow)>>> = (() => {
  // Rows shared by several phases, built once so the table below reads as data.
  const openSection: ScreenplayRow = { to: "section", effects: ["open-section"] };
  // A row that changes nothing but the phase.
  const stay = (to: ScreenplayPhase): ScreenplayRow => ({ to, effects: [] });
  // A note ends the script when it is a notes header, otherwise it only closes an open beat.
  const noteRow = (phase: ScreenplayPhase, boundaryTo: ScreenplayPhase) => (line: ClassifiedLine): ScreenplayRow =>
    line.note === "production-notes" ? { to: "ended", effects: ["flush-beat", "end"] } : { to: boundaryTo, effects: phase === "beat" ? ["flush-beat"] : [] };
  // A tag opens a beat, first opening an implicit section when none exists or closing the previous beat.
  const startBeat = (phase: ScreenplayPhase): ScreenplayRow => ({
    to: "beat",
    effects: phase === "outside" ? ["open-implicit-section", "start-beat"] : phase === "beat" ? ["flush-beat", "start-beat"] : ["start-beat"],
  });
  return {
    outside: {
      blank: stay("outside"),
      marker: openSection,
      timestamp: openSection,
      heading: openSection,
      note: noteRow("outside", "outside"),
      tag: startBeat("outside"),
      prose: (line) => (line.hashed ? stay("outside") : { to: "section", effects: ["open-implicit-section"] }),
    },
    section: {
      blank: stay("section"),
      marker: openSection,
      timestamp: openSection,
      heading: openSection,
      note: noteRow("section", "section"),
      tag: startBeat("section"),
      prose: stay("section"),
    },
    beat: {
      blank: stay("beat"),
      marker: openSection,
      timestamp: openSection,
      heading: openSection,
      note: noteRow("beat", "section"),
      tag: startBeat("beat"),
      prose: { to: "beat", effects: ["append-line"] },
    },
    ended: {},
  };
})();

/** The state a screenplay reader starts in. */
export const SCREENPLAY_START: ScreenplayState = { phase: "outside" };

/** Applies one classified line to a screenplay state: returns the next state and the effects to run; throws when the pair is impossible. */
export function stepScreenplay(state: ScreenplayState, line: ClassifiedLine): { state: ScreenplayState; effects: ScreenplayEffect[] } {
  const entry = SCREENPLAY_TABLE[state.phase][line.cls];
  if (!entry) throw new ImpossibleTransitionError("screenplay", state.phase, line.cls);
  const row = typeof entry === "function" ? entry(line) : entry;
  const beat = row.to === "beat" ? (row.effects.includes("start-beat") ? line.beat : state.beat) : undefined;
  return { state: { phase: row.to, beat }, effects: row.effects };
}

/** Where the story reader is: between paragraphs or inside one. */
export type StoryPhase = "between" | "paragraph";

/** What the caller must do for a story line, in order. */
export type StoryEffect = "flush-paragraph" | "set-tag" | "append-line" | "report-heading";

/** One row of the story transition table. */
interface StoryRow {
  to: StoryPhase;
  effects: StoryEffect[];
}

/** The story transition table: (phase, class) -> row. A missing row is an impossible transition. */
const STORY_TABLE: Record<StoryPhase, Partial<Record<LineClass, StoryRow>>> = {
  between: {
    blank: { to: "between", effects: [] },
    timestamp: { to: "between", effects: [] },
    marker: { to: "between", effects: ["set-tag"] },
    heading: { to: "between", effects: ["set-tag", "report-heading"] },
    prose: { to: "paragraph", effects: ["append-line"] },
  },
  paragraph: {
    blank: { to: "between", effects: ["flush-paragraph"] },
    // A timestamp line inside a paragraph is dropped without closing it, as it always was.
    timestamp: { to: "paragraph", effects: [] },
    marker: { to: "between", effects: ["flush-paragraph", "set-tag"] },
    // A heading is only ever recognised at a paragraph start, so this pair cannot happen.
    prose: { to: "paragraph", effects: ["append-line"] },
  },
};

/** The phase a story reader starts in. */
export const STORY_START: StoryPhase = "between";

/** Applies one classified line to a story phase: returns the next phase and the effects to run; throws when the pair is impossible. */
export function stepStory(phase: StoryPhase, line: ClassifiedLine): { phase: StoryPhase; effects: StoryEffect[] } {
  const row = STORY_TABLE[phase][line.cls];
  if (!row) throw new ImpossibleTransitionError("story", phase, line.cls);
  return { phase: row.to, effects: row.effects };
}

/** One problem the classifier found in a script, named so the user can fix it at intake. */
export interface ScriptIssue {
  kind: "heading-line" | "narration-starts-with-title";
  /** "error" stops intake; "notice" says what was done with the line. */
  severity: "error" | "notice";
  /** 1-based line number in the script, when the issue has one. */
  line?: number;
  text: string;
  message: string;
}

/** Lower-cases and strips punctuation so a title and a narration opening compare word for word. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** True when a narration begins with its own multi-word section title, i.e. the heading leaked into the spoken text. */
export function narrationStartsWithTitle(title: string, narration: string): boolean {
  const titleWords = wordsOf(title);
  if (titleWords.length < 2 || /^(?:segment|scene|shot|act)\s+\d+$/i.test(title.trim())) return false;
  const narrationWords = wordsOf(narration);
  if (narrationWords.length <= titleWords.length) return false;
  return titleWords.every((word, i) => narrationWords[i] === word);
}
