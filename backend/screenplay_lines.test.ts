/**
 * File Description: Behaviour tests for the screenplay line classifier machine (audit item M6). They run real
 * script samples through the public interface and assert each line's class, the machine's states and transitions,
 * the narration that comes out, the intake check that stops a leaked chapter title before any voice is made, and
 * the impossible-transition failure mode. The 'The Closing' case is the 0.5.0 film defect: a bare chapter title
 * above its paragraph was joined into the narration, spoken aloud and captioned.
 * Inputs and outputs: short synthetic script samples -> classes, states, segments, spoken blocks, intake issues.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ImpossibleTransitionError,
  SCREENPLAY_START,
  STORY_START,
  classifyScreenplayLine,
  classifyStoryLine,
  looksLikeHeading,
  stepScreenplay,
  stepStory,
} from "./screenplayLines";
import {
  checkScriptIntake,
  extractSpokenBlocks,
  parseClaudeScript,
  plainTextToSegments,
  plainTextToTaggedScript,
} from "./scriptIntake";
import { runProduction } from "./pipeline/run";
import { FILMS_DIR, VIDEOS_DIR } from "./pipeline/filmStore";

// The 0.5.0 defect: a bare chapter title sits directly above the paragraph it opens.
const CLOSING_STORY = `The Middle
Memory bandwidth is the real limit.

The Closing
Does this mean harnesses are useless?
Not at all, they decide what the model can see.`;

test("classifier: every screenplay line gets exactly one class", () => {
  const cases: Array<[string, string]> = [
    ["", "blank"],
    ["## 0:00-0:20 - The Opening (opening)", "marker"],
    ["0:20 - 0:44 - The Middle", "timestamp"],
    ["Scene 3", "heading"],
    ["[NARRATION] Hello there.", "tag"],
    ["VO: Hello there.", "tag"],
    ["---", "note"],
    ["*(Narration word count: ~450 words)*", "note"],
    ["## Production Notes", "note"],
    ["Plain words inside a beat.", "prose"],
  ];
  for (const [line, cls] of cases) assert.equal(classifyScreenplayLine(line).cls, cls, `"${line}"`);
  const tag = classifyScreenplayLine("[ON SCREEN] 3x faster");
  assert.deepEqual([tag.beat, tag.inline], ["onscreen", "3x faster"]);
});

test("classifier: a story line is a heading only at a paragraph start, with prose directly below, and only when it looks like a title", () => {
  assert.equal(classifyStoryLine("The Closing", { paragraphStart: true, next: "Does this mean it?" }).cls, "heading");
  assert.equal(classifyStoryLine("The Closing", { paragraphStart: false, next: "Does this mean it?" }).cls, "prose");
  assert.equal(classifyStoryLine("The Closing", { paragraphStart: true, next: "" }).cls, "prose", "a lone title line stays the user's own paragraph");
  assert.equal(classifyStoryLine("The Closing", { paragraphStart: true, next: "#Conclusion" }).cls, "prose");
  assert.equal(classifyStoryLine("Third.", { paragraphStart: true, next: "More words." }).cls, "prose", "sentence-ending punctuation is prose");
  assert.equal(classifyStoryLine("Most people think a cache just makes things faster", { paragraphStart: true, next: "x" }).cls, "prose", "a long line is a sentence");
  assert.equal(classifyStoryLine("so remember what is kept", { paragraphStart: true, next: "and why." }).cls, "prose", "lower case is not a title");
  assert.equal(classifyStoryLine("#Start").cls, "marker");
  assert.equal(classifyStoryLine("0:00 - 0:15").cls, "timestamp");
  assert.equal(classifyStoryLine("   ").cls, "blank");
  assert.equal(looksLikeHeading("Why Caches Matter"), true);
  assert.equal(looksLikeHeading("Why caches matter"), false);
});

test("The Closing: a chapter title above its paragraph is never part of the narration", () => {
  const segments = plainTextToSegments(CLOSING_STORY);
  assert.deepEqual(segments.map((s) => s.title), ["The Middle", "The Closing"]);
  const spoken = extractSpokenBlocks(plainTextToTaggedScript(CLOSING_STORY));
  assert.deepEqual(spoken, [
    "Memory bandwidth is the real limit.",
    "Does this mean harnesses are useless? Not at all, they decide what the model can see.",
  ]);
  assert.ok(!spoken.join(" ").includes("The Closing"), "the narrator never says the heading");
  assert.ok(!spoken.join(" ").includes("The Middle"));
});

test("The Closing: intake tells the user a heading was kept out of the narration", () => {
  const issues = checkScriptIntake(CLOSING_STORY);
  assert.deepEqual(issues.map((i) => [i.kind, i.severity, i.line, i.text]), [
    ["heading-line", "notice", 1, "The Middle"],
    ["heading-line", "notice", 4, "The Closing"],
  ]);
  assert.match(issues[1].message, /"The Closing".*not narrated or captioned/);
});

test("ordinary story paragraphs are unchanged: sentence lines of one paragraph still join and #Tags still open sections", () => {
  const story = "#Start\nMost people think a cache just makes things faster.\nIt also decides what gets forgotten.\n\n#Conclusion\nSo remember what is kept, and why.";
  assert.deepEqual(checkScriptIntake(story), []);
  assert.deepEqual(
    plainTextToSegments(story).map((s) => [s.title, s.beats.find((b) => b.type === "narration")?.text]),
    [
      ["Start", "Most people think a cache just makes things faster. It also decides what gets forgotten."],
      ["Conclusion", "So remember what is kept, and why."],
    ],
  );
});

test("intake reports a short lowercase fragment continued on the next line without changing narration", () => {
  const story = "the closing\nprocess is expensive";
  const issues = checkScriptIntake(story);
  assert.deepEqual(issues.map((issue) => [issue.kind, issue.severity, issue.line, issue.text]), [
    ["continued-fragment", "notice", 1, "the closing"],
  ]);
  assert.match(issues[0].message, /line 1.*the closing.*line 2.*process is expensive/);
  assert.deepEqual(
    plainTextToSegments(story).map((segment) => segment.beats.find((beat) => beat.type === "narration")?.text),
    ["the closing process is expensive"],
  );
  assert.deepEqual(checkScriptIntake("A short sentence.\nThis starts a new sentence."), []);
});

test("tagged screenplay: narration that begins with its own chapter title is an intake error", () => {
  const leaked = "## 3:00-3:20 - The Closing\n\n[NARRATION]\nThe Closing does this mean harnesses are useless?\n";
  const issues = checkScriptIntake(leaked);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "narration-starts-with-title");
  assert.equal(issues[0].severity, "error");
  assert.match(issues[0].message, /would read the heading aloud/);

  const clean = "## 3:00-3:20 - The Closing\n\n[NARRATION]\nDoes this mean harnesses are useless?\n";
  assert.deepEqual(checkScriptIntake(clean), []);
  const oneWord = "## 3:00-3:20 - Closing\n\n[NARRATION]\nClosing the loop is the whole job.\n";
  assert.equal(checkScriptIntake(oneWord)[0]?.kind, "narration-starts-with-title", "a one-word title at the start is flagged");
  const titleOnly = "## Closing\n[NARRATION]\nClosing.\n";
  assert.equal(checkScriptIntake(titleOnly)[0]?.kind, "narration-starts-with-title", "narration consisting only of its title is flagged");
});

test("intake stage: a leaked title stops the run before any voice is synthesized, and a story heading is reported", async () => {
  const slug = `m6-intake-${Date.now().toString(36)}`;
  const messages: string[] = [];
  try {
    await assert.rejects(
      runProduction(
        {
          script: "## 0:00-0:20 - The Closing\n\n[NARRATION]\nThe Closing does this mean harnesses are useless?\n",
          title: "M6",
          slug,
          ttsBackend: "tone",
          design: "templates",
          broll: false,
          stopAfter: "intake",
          resume: false,
          syncToPreview: false,
        },
        (event) => messages.push(`${event.stage}:${event.status}`),
      ),
      /would read the heading aloud/,
    );
    assert.ok(messages.includes("intake:failed"));
    assert.ok(!messages.some((m) => m.startsWith("narrate")), "nothing was narrated");

    const events: string[] = [];
    await runProduction(
      { script: CLOSING_STORY, title: "M6", slug, ttsBackend: "tone", design: "templates", broll: false, stopAfter: "intake", resume: false, syncToPreview: false },
      (event) => events.push(event.message),
    );
    assert.ok(events.some((m) => /"The Closing" is a chapter heading/.test(m)));
  } finally {
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
  }
});

test("screenplay machine: states and transitions through a section, its beats and a notes header", () => {
  let state = SCREENPLAY_START;
  const run = (line: string) => {
    const step = stepScreenplay(state, classifyScreenplayLine(line));
    state = step.state;
    return step.effects;
  };
  assert.deepEqual(run(""), []);
  assert.equal(state.phase, "outside");
  assert.deepEqual(run("## 0:00-0:10 - One"), ["open-section"]);
  assert.equal(state.phase, "section");
  assert.deepEqual(run("Stray words before any tag."), [], "prose with no open beat is ignored");
  assert.deepEqual(run("[NARRATION]"), ["start-beat"]);
  assert.deepEqual([state.phase, state.beat], ["beat", "narration"]);
  assert.deepEqual(run("Spoken words."), ["append-line"]);
  assert.deepEqual(run("[ON SCREEN] Label"), ["flush-beat", "start-beat"]);
  assert.deepEqual([state.phase, state.beat], ["beat", "onscreen"]);
  assert.deepEqual(run("---"), ["flush-beat"]);
  assert.equal(state.phase, "section");
  assert.deepEqual(run("## Production Notes"), ["flush-beat", "end"]);
  assert.equal(state.phase, "ended");
});

test("screenplay machine: no line is possible after the notes header ends the script", () => {
  const ended = { phase: "ended" as const };
  for (const line of ["", "## 0:00-0:10 - One", "[NARRATION] hi", "words"]) {
    assert.throws(() => stepScreenplay(ended, classifyScreenplayLine(line)), ImpossibleTransitionError, `"${line}"`);
  }
});

test("story machine: a heading cannot occur inside an open paragraph", () => {
  const heading = classifyStoryLine("The Closing", { paragraphStart: true, next: "Words follow." });
  assert.deepEqual(stepStory(STORY_START, heading), { phase: "between", effects: ["set-tag", "report-heading"] });
  assert.throws(() => stepStory("paragraph", heading), (err: unknown) => {
    assert.ok(err instanceof ImpossibleTransitionError);
    assert.equal(err.state, "paragraph");
    assert.equal(err.cls, "heading");
    return true;
  });
  assert.deepEqual(stepStory("paragraph", classifyStoryLine("")), { phase: "between", effects: ["flush-paragraph"] });
});

test("parseClaudeScript still reads a mixed legacy and bracket screenplay through the machine", () => {
  const script = "Scene 1\nVISUAL: A drop of water.\nVO: First words.\nSFX: splash\nstray line\n0:10 - 0:20 - Two\n[NARRATION]\nSecond words.\n***\nNotes\n## Production Notes\nignored";
  const segments = parseClaudeScript(script);
  assert.deepEqual(segments.map((s) => [s.title, s.beats.map((b) => `${b.type}:${b.text}`)]), [
    ["Scene 1", ["visual:A drop of water.", "narration:First words."]],
    ["Two", ["narration:Second words."]],
  ]);
});
