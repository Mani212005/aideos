/**
 * File Description: Behaviour tests for the story-first script model: the deterministic plain-text to tagged
 * conversion (paragraph grouping, #Tag sections, empty visual and on-screen slots, word-count timings at the
 * chosen voice speed, idempotence, tagged scripts untouched), the story view the editor shows, the narration
 * diff, and the visible narration change list. These encode the captain's decision that a user's plain story
 * is converted by Aideos itself and never reformatted by an agent.
 * Inputs and outputs: plain and tagged script text -> converted scripts, story sections, change entries.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  estimateNarrationSeconds,
  extractSpokenBlocks,
  hasScreenplayTags,
  parseClaudeScript,
  plainTextToSegments,
  plainTextToTaggedScript,
} from "./scriptIntake";
import { diffNarration, narrationLines, scriptToStory, storyToScript } from "./storyScript";
import { readNarrationLog, syncNarrationLog } from "./narrationLog";
import { flattenScreenplay } from "./pipeline/design";

const STORY = `#Start
Most people think a cache just makes things faster.
It also decides what gets forgotten.

The second idea is smaller.

#Conclusion
So remember what is kept, and why.`;

const TAGGED = `## 0:00-0:15 - THE PROBLEM

[VISUAL]
A small draft model next to a massive target model.

[ON SCREEN]
3x Faster Inference

[NARRATION]
Autoregressive inference is memory bandwidth bound.
`;

// Builds a paragraph of exactly n words.
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

test("plain text: each #Tag opens a section, and the lines of one paragraph join into one NARRATION line verbatim", () => {
  const segments = plainTextToSegments(STORY);
  assert.deepEqual(segments.map((s) => s.title), ["Start", "Conclusion"]);
  assert.equal(
    segments[0].beats.find((b) => b.type === "narration")?.text,
    "Most people think a cache just makes things faster. It also decides what gets forgotten.",
  );
});

test("plain text: a paragraph that follows a #Tag stays in that section as its own narration line", () => {
  const segments = plainTextToSegments(STORY);
  const start = segments.find((s) => s.title === "Start");
  assert.ok(start);
  assert.deepEqual(
    start.beats.filter((b) => b.type === "narration").map((b) => b.text),
    [
      "Most people think a cache just makes things faster. It also decides what gets forgotten.",
      "The second idea is smaller.",
    ],
  );
  const conclusion = segments.find((s) => s.title === "Conclusion");
  assert.ok(conclusion);
  assert.deepEqual(
    conclusion.beats.filter((b) => b.type === "narration").map((b) => b.text),
    ["So remember what is kept, and why."],
  );
});

test("plain text with no tags: every blank-line paragraph group becomes its own section", () => {
  const segments = plainTextToSegments("First thought.\n\nSecond thought here.\n\nThird.");
  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((s) => s.beats.find((b) => b.type === "narration")?.text),
    ["First thought.", "Second thought here.", "Third."],
  );
  assert.equal(new Set(segments.map((s) => s.id)).size, 3, "section ids are unique");
});

test("converted script: VISUAL and ON SCREEN slots start empty, so parsing sees only the narration", () => {
  const script = plainTextToTaggedScript(STORY);
  assert.match(script, /\[VISUAL\]\n\s*\n\s*\[ON SCREEN\]\n\s*\n/, "empty slots are written out for the agent to fill");
  assert.equal(hasScreenplayTags(script), true);
  for (const segment of parseClaudeScript(script)) {
    assert.deepEqual(
      [...new Set(segment.beats.map((b) => b.type))],
      ["narration"],
      "no visual or on-screen text exists until the agent writes it",
    );
  }
  assert.deepEqual(extractSpokenBlocks(script), [
    "Most people think a cache just makes things faster. It also decides what gets forgotten.",
    "The second idea is smaller.",
    "So remember what is kept, and why.",
  ]);
});

test("converted script: #Tag markers are never spoken, with or without a space after the hash", () => {
  for (const marker of ["#Start", "# Start", "## Start"]) {
    const spoken = extractSpokenBlocks(plainTextToTaggedScript(`${marker}\nHello there.`));
    assert.deepEqual(spoken, ["Hello there."]);
    assert.deepEqual(extractSpokenBlocks(`${marker}\nHello there.`), ["Hello there."], "raw plain text is segmented the same way");
  }
});

test("a sentence that starts with a hashtag-style number is narration, not a section marker", () => {
  assert.deepEqual(extractSpokenBlocks(plainTextToTaggedScript("#1 reason is speed.")), ["#1 reason is speed."]);
});

test("timings are estimated from word count at the chosen voice speed", () => {
  // 150 words at 150 wpm is 60 s of speech plus a 0.8 s breathing buffer at normal speed.
  assert.equal(estimateNarrationSeconds(words(150), 1), 60.8);
  assert.equal(estimateNarrationSeconds(words(150), 0.75), 80.8, "a slower voice takes longer");
  assert.equal(estimateNarrationSeconds(words(150), 2), 30.8, "a faster voice takes less time");

  const normal = plainTextToSegments(`${words(150)}\n\n${words(75)}`, { speed: 1 });
  assert.deepEqual([normal[0].timeStart, normal[0].timeEnd], ["0:00", "1:01"]);
  assert.equal(normal[1].timeStart, "1:01", "the next section starts where the previous one ended");

  const slow = plainTextToSegments(`${words(150)}\n\n${words(75)}`, { speed: 0.75 });
  assert.equal(slow[0].timeEnd, "1:21");
});

test("tagged scripts pass through byte for byte, and converting twice changes nothing", () => {
  assert.equal(plainTextToTaggedScript(TAGGED), TAGGED);
  assert.equal(plainTextToTaggedScript("VO: Hello there."), "VO: Hello there.", "legacy tags count as tagged");

  const once = plainTextToTaggedScript(STORY);
  assert.equal(plainTextToTaggedScript(once), once);
  assert.equal(plainTextToTaggedScript(""), "");
  assert.equal(plainTextToTaggedScript("  \n\n "), "  \n\n ");
});

test("story view: narration paragraphs with the agent's notes beside them, tags stay internal", () => {
  const filled = plainTextToTaggedScript(STORY).replace(/\[VISUAL\]\n\n/, "[VISUAL]\nA vault door swinging shut.\n\n");
  const story = scriptToStory(filled);
  assert.equal(story[0].title, "Start");
  assert.equal(story[0].paragraphs.length, 2);
  assert.equal(story[0].paragraphs[0].visual[0], "A vault door swinging shut.");
  assert.deepEqual(story[0].paragraphs[1].visual.filter(Boolean), []);

  // A hand-tagged script reads the same way, notes before the narration attach to it.
  const hand = scriptToStory(TAGGED);
  assert.equal(hand[0].paragraphs.length, 1);
  assert.equal(hand[0].paragraphs[0].narration, "Autoregressive inference is memory bandwidth bound.");
  assert.deepEqual(hand[0].paragraphs[0].visual, ["A small draft model next to a massive target model."]);
  assert.deepEqual(hand[0].paragraphs[0].onScreen, ["3x Faster Inference"]);
});

test("multi-beat Claude script: notes precede their narration and remain coupled through story and pipeline flattening", () => {
  const multiBeat = `## 0:00-0:30 - THE PROBLEM

[VISUAL]
First visual direction

[ON SCREEN]
First on-screen text

[NARRATION]
First narration line.

[VISUAL]
Second visual direction

[ON SCREEN]
Second on-screen text

[NARRATION]
Second narration line.
`;
  const story = scriptToStory(multiBeat);
  assert.equal(story[0].paragraphs.length, 2);
  assert.deepEqual(story[0].paragraphs[0].visual, ["First visual direction"]);
  assert.deepEqual(story[0].paragraphs[0].onScreen, ["First on-screen text"]);
  assert.equal(story[0].paragraphs[0].narration, "First narration line.");
  assert.deepEqual(story[0].paragraphs[1].visual, ["Second visual direction"]);
  assert.deepEqual(story[0].paragraphs[1].onScreen, ["Second on-screen text"]);
  assert.equal(story[0].paragraphs[1].narration, "Second narration line.");

  const serialized = storyToScript(story);
  const beats = flattenScreenplay(parseClaudeScript(serialized));
  assert.equal(beats.length, 2);
  assert.equal(beats[0].visual, "First visual direction");
  assert.deepEqual(beats[0].onscreen, ["First on-screen text"]);
  assert.equal(beats[0].narration, "First narration line.");
  assert.equal(beats[1].visual, "Second visual direction");
  assert.deepEqual(beats[1].onscreen, ["Second on-screen text"]);
  assert.equal(beats[1].narration, "Second narration line.");
});

test("story view: writing the story back keeps every narration line and note, and plain text reads as a story too", () => {
  const story = scriptToStory(STORY);
  assert.equal(story.length, 2);
  const round = scriptToStory(storyToScript(story));
  assert.deepEqual(
    round.map((s) => s.paragraphs.map((p) => p.narration)),
    story.map((s) => s.paragraphs.map((p) => p.narration)),
  );

  story[0].paragraphs[0].visual = ["Close on a cache line"];
  story[0].paragraphs[0].onScreen = ["Cache"];
  const edited = storyToScript(story);
  assert.deepEqual(extractSpokenBlocks(edited), extractSpokenBlocks(STORY));
  const again = scriptToStory(edited);
  assert.deepEqual(again[0].paragraphs[0].visual, ["Close on a cache line"]);
  assert.deepEqual(again[0].paragraphs[0].onScreen, ["Cache"]);
});

test("diffNarration: edited, added and removed lines are told apart, unchanged lines are not listed", () => {
  assert.deepEqual(diffNarration(["a", "b", "c"], ["a", "b", "c"]), []);
  assert.deepEqual(diffNarration(["a", "b", "c"], ["a", "B", "c"]), [{ kind: "edited", before: "b", after: "B" }]);
  assert.deepEqual(diffNarration(["a", "c"], ["a", "b", "c"]), [{ kind: "added", after: "b" }]);
  assert.deepEqual(diffNarration(["a", "b", "c"], ["a", "c"]), [{ kind: "removed", before: "b" }]);
  assert.deepEqual(diffNarration([], ["x", "y"]), [
    { kind: "added", after: "x" },
    { kind: "added", after: "y" },
  ]);
});

test("change list: the user's own story is the baseline, an agent's narration edits are recorded with who and what", () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-narration-"));
  try {
    fs.writeFileSync(path.join(pkg, "script.md"), plainTextToTaggedScript(STORY));
    assert.deepEqual(syncNarrationLog(pkg, "user"), [], "creation records a baseline, not changes");
    assert.deepEqual(readNarrationLog(pkg)?.entries, []);
    assert.deepEqual(syncNarrationLog(pkg, "agent"), [], "nothing changed, nothing listed");

    // The agent rewrites one paragraph and adds one, straight in the file.
    const edited = plainTextToTaggedScript(STORY.replace("The second idea is smaller.", "The second idea is smaller, and sharper.") + "\n\nOne more thing.");
    fs.writeFileSync(path.join(pkg, "script.md"), edited);
    const added = syncNarrationLog(pkg, "agent", new Date("2026-11-07T10:00:00Z"));
    assert.deepEqual(
      added.map(({ id, source, kind, before, after }) => ({ id, source, kind, before, after })),
      [
        { id: 1, source: "agent", kind: "edited", before: "The second idea is smaller.", after: "The second idea is smaller, and sharper." },
        { id: 2, source: "agent", kind: "added", before: undefined, after: "One more thing." },
      ],
    );
    assert.equal(added[0].at, "2026-11-07T10:00:00.000Z");

    // The same edit is not listed twice, and a later user edit is attributed to the user.
    assert.deepEqual(syncNarrationLog(pkg, "agent"), []);
    fs.writeFileSync(path.join(pkg, "script.md"), edited.replace("One more thing.", "One last thing."));
    const later = syncNarrationLog(pkg, "user");
    assert.deepEqual(later.map((e) => [e.id, e.source, e.kind]), [[3, "user", "edited"]]);
    assert.equal(readNarrationLog(pkg)?.entries.length, 3);
    assert.deepEqual(narrationLines(edited).length, 4);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

test("change list: an agent writing the whole script into an empty project lists every line as added", () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-narration-"));
  try {
    fs.writeFileSync(path.join(pkg, "script.md"), "");
    syncNarrationLog(pkg, "user");
    fs.writeFileSync(path.join(pkg, "script.md"), plainTextToTaggedScript("Why caches exist.\n\nWhat they forget."));
    const entries = syncNarrationLog(pkg, "agent");
    assert.deepEqual(entries.map((e) => [e.source, e.kind, e.after]), [
      ["agent", "added", "Why caches exist."],
      ["agent", "added", "What they forget."],
    ]);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});
