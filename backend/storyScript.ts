/**
 * File Description: The story-first view of a script. Reads the internal tagged script (or a plain-text
 * story, converted deterministically) as sections of narration paragraphs, each carrying the agent's
 * visual and on-screen notes, writes that model back to the tagged markdown, and diffs two versions of
 * the narration into a change list. Pure and isomorphic: no Node imports, so the studio editor, the
 * backend change log and the tests share one implementation.
 * Inputs and outputs: script text or story sections -> story sections, tagged script text, narration changes.
 * Used by: editor/src/components/ScriptEditor.tsx, backend/narrationLog.ts, backend/storyScript.test.ts.
 */

import {
  parseClaudeScript,
  plainTextToSegments,
  serializeSegmentsToScript,
  hasScreenplayTags,
  extractSpokenBlocks,
  type ScriptBeat,
  type ScriptSegment,
} from "./scriptIntake";

/** One narration paragraph and the notes the agent wrote beside it. */
export interface StoryParagraph {
  /** Stable within one parse: `<section id>-<n>`. */
  id: string;
  /** What the narrator says, verbatim. */
  narration: string;
  /** The agent's visual directions for this paragraph (tag stays internal). */
  visual: string[];
  /** The agent's on-screen text for this paragraph. */
  onScreen: string[];
}

/** One `#Tag` section (or untagged paragraph) of the story. */
export interface StorySection {
  id: string;
  title: string;
  timeStart?: string;
  timeEnd?: string;
  paragraphs: StoryParagraph[];
}

/** What happened to one narration line between two versions of a script. */
export type NarrationChangeKind = "added" | "edited" | "removed";

/** One entry of the narration change list. */
export interface NarrationChange {
  kind: NarrationChangeKind;
  /** The line before the change (absent for an added line). */
  before?: string;
  /** The line after the change (absent for a removed line). */
  after?: string;
}

/** Groups a segment's beats into narration paragraphs; notes ride with the narration they precede. */
function segmentToSection(segment: ScriptSegment): StorySection {
  const paragraphs: StoryParagraph[] = [];
  let pendingVisual: string[] = [];
  let pendingOnScreen: string[] = [];

  for (const beat of segment.beats) {
    if (beat.type === "visual") {
      if (beat.text.trim()) pendingVisual.push(beat.text);
    } else if (beat.type === "onscreen") {
      if (beat.text.trim()) pendingOnScreen.push(beat.text);
    } else {
      paragraphs.push({
        id: `${segment.id}-${paragraphs.length + 1}`,
        narration: beat.text,
        visual: pendingVisual,
        onScreen: pendingOnScreen,
      });
      pendingVisual = [];
      pendingOnScreen = [];
    }
  }

  if (paragraphs.length > 0 && (pendingVisual.length > 0 || pendingOnScreen.length > 0)) {
    const last = paragraphs[paragraphs.length - 1];
    last.visual.push(...pendingVisual);
    last.onScreen.push(...pendingOnScreen);
  }

  return { id: segment.id, title: segment.title, timeStart: segment.timeStart, timeEnd: segment.timeEnd, paragraphs };
}

/** Reads a script (tagged, legacy-tagged or plain text) as story sections, dropping sections with no narration. */
export function scriptToStory(script: string, options?: { speed?: number }): StorySection[] {
  const segments = hasScreenplayTags(script) ? parseClaudeScript(script) : plainTextToSegments(script, options);
  return segments.map(segmentToSection).filter((section) => section.paragraphs.length > 0);
}

/** Writes story sections back to the internal tagged markdown: notes first, then narration (empty slots kept). */
export function storyToScript(story: StorySection[]): string {
  const segments: ScriptSegment[] = story.map((section) => {
    const beats: ScriptBeat[] = [];
    for (const paragraph of section.paragraphs) {
      const visual = paragraph.visual.filter((t) => t.trim()).length > 0 ? paragraph.visual.filter((t) => t.trim()) : [""];
      const onScreen = paragraph.onScreen.filter((t) => t.trim()).length > 0 ? paragraph.onScreen.filter((t) => t.trim()) : [""];
      visual.forEach((text) => beats.push({ type: "visual", text }));
      onScreen.forEach((text) => beats.push({ type: "onscreen", text }));
      beats.push({ type: "narration", text: paragraph.narration });
    }
    return { id: section.id, title: section.title, timeStart: section.timeStart, timeEnd: section.timeEnd, beats };
  });
  return segments.length > 0 ? serializeSegmentsToScript(segments) : "";
}

/** The spoken narration lines of a script, in order: the one list the voice-over and the change list share. */
export function narrationLines(script: string): string[] {
  return extractSpokenBlocks(script).map((line) => line.trim()).filter(Boolean);
}

/**
 * Compares two versions of the narration. Lines both versions share (in order) are untouched; between
 * those anchors a removed line and an added line at the same place are one edit, and any surplus on
 * either side is a plain removal or addition.
 */
export function diffNarration(before: string[], after: string[]): NarrationChange[] {
  const n = before.length;
  const m = after.length;
  // Longest common subsequence table over exact line text.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const changes: NarrationChange[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k++) changes.push({ kind: "edited", before: removed[k], after: added[k] });
    for (const line of removed.slice(pairs)) changes.push({ kind: "removed", before: line });
    for (const line of added.slice(pairs)) changes.push({ kind: "added", after: line });
    removed = [];
    added = [];
  };

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      flush();
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
      removed.push(before[i++]);
    } else {
      added.push(after[j++]);
    }
  }
  flush();
  return changes;
}
