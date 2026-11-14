/**
 * File Description: Behavioural tests of the Render IR emitter through its public interface: the emitted document validates and spans the delivered video; every element track reproduces the scene compiler's state at every frame, holding the story's last frame through the end card; the end card's slow push scales the stage and the text cards together; text cards appear with their shots and keep the last one under the end card; headline words enter in order, wrap inside the stage and the accent word's underline draws from the left; a counter shows each value once and lands on its target; the narration follows the soundtrack's head and tail ramps; a music section that starts after frame 0 keys its envelope in film frames; and a film the native renderer cannot draw is refused with every reason.
 * Inputs and outputs: the synthetic scene film in backend/testSupport/nativeSceneFilm.ts and a fake measurer -> asserted IR values.
 * Used by: npm test (Node test runner).
 */

import "../testSupport/fixtureVideosDir";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileScene } from "../../src/dl/scene/compile";
import type { Scene } from "../../src/dl/scene/types";
import { buildTimeline } from "../../src/dl/camera";
import { voiceLevel } from "../../src/dl/Soundtrack";
import { buildVoiceTimeline } from "../../src/dl/audio/voiceActivity";
import { dbGain, mixSections, sectionEnvelope, speechGain } from "../../src/dl/audio/sectionMixer";
import { normalizeFilmSoundtrack } from "../../src/dl/schema";
import { quantize } from "../../src/dl/scene/svgAnimation";
import { emitRenderIr, nativeSupport, sampleTrack, NativeUnsupportedError, type NativeFormat } from "./emit";
import type { Keyframe, Node, RenderIr } from "./schema";
import { fakeMeasurer, nativeSceneFilm, NATIVE_SVG_SOURCES, PROBE_SVG_SOURCE } from "../testSupport/nativeSceneFilm";
import type { Film } from "../../src/dl/schema";
import { captionWordsForFilm } from "../../src/dl/captionsParser";
import { deliveryTimeline } from "../../src/dl/delivery";

/** Emits one format of a film with the fake measurer and identity path resolution. */
function emit(film: Film, format: NativeFormat = "long"): RenderIr {
  return emitRenderIr({ film, format, svgSources: NATIVE_SVG_SOURCES, measure: fakeMeasurer(), resolvePath: (p) => `/repo/${p}` }).ir;
}

/** Every node of a tree, depth first. */
function nodes(list: Node[]): Node[] {
  return list.flatMap((n) => (n.kind === "group" ? [n, ...nodes(n.children)] : [n]));
}

/** The node with an id, or a failed assertion. */
function byId(ir: RenderIr, id: string): Node {
  const found = nodes([...ir.stage, ...ir.overlay]).find((n) => n.id === id);
  assert.ok(found, `no node ${id}`);
  return found;
}

/** A node track's value at a frame (the node's static value when no track drives it). */
function trackAt(n: Node, property: string, frame: number, fallback: number): number {
  const t = "tracks" in n ? n.tracks.find((k) => k.property === property) : undefined;
  return t ? sampleTrack(t.keyframes as Keyframe[], frame) : fallback;
}

/** Whether a node is drawn at a frame (its own span; ancestors are checked by the caller). */
function visibleAt(n: Node, frame: number): boolean {
  return !n.visible || (frame >= n.visible.fromFrame && frame < n.visible.toFrame);
}

test("the emitted document validates and spans the story plus the end card", () => {
  const film = nativeSceneFilm();
  for (const format of ["long", "reel"] as const) {
    const ir = emit(film, format);
    const delivery = deliveryTimeline(film, format);
    assert.equal(ir.film.durationFrames, delivery.totalFrames);
    assert.deepEqual(Object.keys(ir.formats), [format]);
    const rail = byId(ir, "rail");
    assert.deepEqual(rail.visible, { fromFrame: 0, toFrame: delivery.card!.from }, "the rail leaves with the story");
    assert.equal(rail.kind === "rail" && rail.progressFrames, delivery.storyFrames, "the reel bar fills over the story");
    const endCard = byId(ir, "end-card");
    assert.deepEqual(endCard.visible, { fromFrame: delivery.card!.from, toFrame: delivery.totalFrames });
    if (endCard.kind === "endCard") {
      assert.deepEqual([endCard.monoFont, endCard.chipFont, endCard.surface, endCard.hairline, endCard.muted], ["mono-400", "mono-700", "#141416", "#F5F5F51A", "#8A8A8E"], "the theme's own end card faces and colours");
    }
    if (rail.kind === "rail") {
      assert.deepEqual(rail.chapters.map((c) => [c.title, c.startFrame]), [["Arrival", 0], ["Count", 180]], "one rail chapter per film chapter, from its first cut");
    }
  }
});

test("element tracks reproduce the scene compiler at every frame and hold the story's last frame", () => {
  const film = nativeSceneFilm();
  const scene = film.scene as unknown as Scene;
  const compiled = compileScene(scene, { clockMs: 0 });
  const ir = emit(film);
  const storyLast = deliveryTimeline(film, "long").storyFrames - 1;
  const node = byId(ir, "asset-probe");
  assert.equal(node.kind, "svg");
  if (node.kind !== "svg") return;
  const slots: Array<[string, string]> = [];
  for (const t of node.elementTracks) slots.push([t.target, t.property]);
  assert.ok(slots.length >= 9, "every driven slot has a track");
  let compared = 0;
  for (let f = 0; f < ir.film.durationFrames; f++) {
    const states = compiled.frames[Math.min(f, storyLast)].entities.find((e) => e.entityId === "probe")!.elementStates!;
    for (const t of node.elementTracks) {
      const raw: number = sampleTrack(t.keyframes, f);
      const value = t.property === "opacity" || t.property === "drawOn" ? quantize(Math.min(1, Math.max(0, raw))) : quantize(raw);
      const expected: number = (states[t.target] as unknown as Record<string, number>)[t.property];
      assert.equal(value, expected, `${t.target}.${t.property} at frame ${f}`);
      compared++;
    }
  }
  assert.ok(compared > 1000);
  const origins = new Map(node.elementTracks.filter((t) => t.origin).map((t) => [t.target, t.origin]));
  assert.deepEqual(origins.get("bar"), { x: 100, y: 100 });
  assert.deepEqual(origins.get("arm"), { x: 20, y: 0 });
  assert.ok(node.elementTracks.every((t) => t.origin === undefined || ["scaleX", "scaleY", "rotate"].includes(t.property)), "only scale and rotate carry an origin");
  const dot = node.elementTracks.find((t) => t.target === "dot" && t.property === "translateX")!;
  assert.ok(dot.keyframes.length < 10, `adjacent clips stay sparse (${dot.keyframes.length} keyframes)`);
});

test("the end card's slow push scales the stage and the text cards together about the frame centre", () => {
  const film = nativeSceneFilm();
  const ir = emit(film);
  const card = deliveryTimeline(film, "long").card!;
  const zoom = ir.camera!.zoom;
  const overlay = byId(ir, "story-overlay");
  for (const f of [0, card.from - 1]) {
    assert.equal(sampleTrack(zoom, f), 1);
    assert.equal(trackAt(overlay, "scale", f, 1), 1);
  }
  const end = ir.film.durationFrames - 1;
  const push = 1 + 0.01 * Math.min(1, (end - card.from) / card.durationInFrames);
  assert.ok(Math.abs(sampleTrack(zoom, end) - push) < 1e-12);
  assert.ok(Math.abs(trackAt(overlay, "scale", end, 1) - push) < 1e-12);
  assert.ok(Math.abs(trackAt(overlay, "x", end, 0) - 960 * (1 - push)) < 1e-9, "scaled about the frame centre");
  assert.ok(Math.abs(trackAt(overlay, "y", end, 0) - 540 * (1 - push)) < 1e-9);
});

test("text cards appear with their shots and the last one stays under the end card", () => {
  const film = nativeSceneFilm();
  const ir = emit(film);
  const timeline = buildTimeline(film);
  const cards = (byId(ir, "story-overlay") as Extract<Node, { kind: "group" }>).children;
  assert.deepEqual(cards.map((c) => c.id), ["card-0", "card-2", "card-3"], "only frame shots with blocks get a card");
  assert.deepEqual(cards[0].visible, { fromFrame: timeline[0].from, toFrame: timeline[0].to });
  assert.deepEqual(cards[2].visible, { fromFrame: timeline[3].from, toFrame: ir.film.durationFrames });
});

test("headline words enter in order, wrap inside the stage, and the accent underline draws from the left", () => {
  const ir = emit(nativeSceneFilm());
  const word = (i: number, suffix = "") => byId(ir, `card-0-b0-w${i}${suffix}`) as Extract<Node, { kind: "text" }>;
  const [hello, core, tail] = [word(0), word(1, "-core"), word(2)];
  assert.equal(core.text, "native", "the accent word's core");
  assert.equal(hello.text, "Hello,", "punctuation stays with its word");
  assert.equal(core.color, "#635BFF");
  assert.equal(tail.color, "#F5F5F5");
  // Each word fades in from 0 and lands 70 ms after the previous one.
  assert.equal(trackAt(hello, "opacity", 0, 1), 0);
  assert.equal(trackAt(hello, "opacity", 30, 1), 1);
  assert.ok(trackAt(hello, "opacity", 5, 1) > trackAt(core, "opacity", 5, 1), "the first word leads");
  assert.ok(trackAt(hello, "y", 1, 0) > 0 && trackAt(hello, "y", 30, 1) === 0, "words rise into place");
  const underline = byId(ir, "card-0-b0-w1-underline");
  assert.equal(trackAt(underline, "scaleX", 7, 1), 0, "the underline waits for its word");
  assert.equal(trackAt(underline, "scaleX", 29, 0), 1);
  const mid = trackAt(underline, "scaleX", 12, 1);
  assert.equal(underline.kind, "rect");
  const box = (underline as Extract<Node, { kind: "rect" }>).placement.long!;
  assert.ok(mid > 0 && mid < 1);
  assert.ok(Math.abs(trackAt(underline, "x", 12, 0) - ((mid - 1) * box.w) / 2) < 1e-9, "the left edge stays put while it grows");
  // The closing line is wider than the stage, so it wraps onto rows centred in the frame.
  const closing = nodes(ir.overlay).filter((n): n is Extract<Node, { kind: "text" }> => n.kind === "text" && n.id.startsWith("card-3-"));
  const rows = [...new Set(closing.map((n) => n.placement.long!.y))];
  assert.ok(rows.length >= 2, "the long line wraps");
  for (const y of rows) {
    const row = closing.filter((n) => n.placement.long!.y === y);
    const left = Math.min(...row.map((n) => n.placement.long!.x));
    const right = Math.max(...row.map((n) => n.placement.long!.x + n.placement.long!.w - n.placement.long!.fontSize));
    assert.ok(left >= 96 && right <= 1920 - 96 + 1e-6, "rows stay inside the stage margins");
    assert.ok(Math.abs((left + right) / 2 - 960) < 1e-6, "rows are centred");
  }
});

test("a counter shows each value once, contiguously, and lands on its target", () => {
  const film = nativeSceneFilm();
  const ir = emit(film);
  const counter = byId(ir, "card-2-b0") as Extract<Node, { kind: "group" }>;
  const timeline = buildTimeline(film);
  const groups = counter.children;
  assert.equal(groups[0].visible!.fromFrame, timeline[2].from);
  for (let i = 1; i < groups.length; i++) assert.equal(groups[i].visible!.fromFrame, groups[i - 1].visible!.toFrame, "values follow one another");
  assert.equal(groups[groups.length - 1].visible!.toFrame, timeline[2].to);
  const values = groups.map((g) => Number(((g as Extract<Node, { kind: "group" }>).children[0] as Extract<Node, { kind: "text" }>).text));
  assert.deepEqual(values, [...values].sort((a, b) => a - b), "the count only rises");
  assert.equal(values[values.length - 1], 22);
  const last = (groups[groups.length - 1] as Extract<Node, { kind: "group" }>).children.map((c) => (c as Extract<Node, { kind: "text" }>).text);
  assert.deepEqual(last, ["22", "TRANSMITTER POWER", "watts"]);
  assert.ok(visibleAt(groups[0], timeline[2].from) && !visibleAt(groups[0], timeline[2].to));
});

test("the narration follows the soundtrack's head and tail ramps", () => {
  const film = nativeSceneFilm({ voiceover: { src: "videos/native-probe/voiceover.wav", volume: 0.8 } });
  const result = emitRenderIr({ film, format: "long", svgSources: NATIVE_SVG_SOURCES, measure: fakeMeasurer(), resolvePath: (p) => `/repo/${p}` });
  const story = deliveryTimeline(film, "long").storyFrames;
  const [clip] = result.ir.audio;
  assert.equal(clip.gain, 1);
  for (const f of [0, 3, 6, 50, story - 12, story - 5, story]) {
    assert.ok(Math.abs(sampleTrack(clip.gainEnvelope, f) - voiceLevel(f, 0.8, story)) < 1e-12, `frame ${f}`);
  }
  assert.ok(result.files.some((f) => f.path === "audio/voiceover.wav" && "from" in f && f.from === "/repo/videos/native-probe/voiceover.wav"));
});

test("a music section that starts after frame 0 keys its gain envelope in film frames", () => {
  const film = nativeSceneFilm({
    soundtrack: {
      sections: [{ item: "mk-556", from: 0, to: 6 }, { item: "mk-615", from: 6, to: 12.5 }],
      speech: [{ startSec: 1, endSec: 4 }, { startSec: 7, endSec: 10 }],
    },
  });
  assert.deepEqual(nativeSupport(film, "long"), []);
  const ir = emit(film);
  const delivery = deliveryTimeline(film, "long");
  const soundtrack = normalizeFilmSoundtrack(film);
  const story = delivery.storyFrames;
  const voice = buildVoiceTimeline(soundtrack.speech.map((i) => ({ startSec: i.startSec, endSec: Math.min(i.endSec, story / film.fps) })));
  const sections = mixSections(soundtrack, delivery);
  assert.equal(sections.length, 2);
  const late = sections[1];
  assert.ok(late.from > 0);
  const clip = ir.audio.find((c) => c.id === "music-1");
  assert.ok(clip);
  assert.equal(clip.startFrame, late.from);
  assert.equal(clip.gainEnvelope[0].frame, late.from);
  assert.equal(clip.gainEnvelope[clip.gainEnvelope.length - 1].frame, late.from + late.durationInFrames);
  for (let f = late.from; f < late.from + late.durationInFrames; f++) {
    const expected = late.gain * sectionEnvelope(late, f - late.from) *
      (late.duck ? speechGain(f / film.fps, voice, soundtrack.mix, story / film.fps) : dbGain(soundtrack.mix.musicOnlyGainDb));
    assert.ok(Math.abs(sampleTrack(clip.gainEnvelope, f) - Math.min(4, expected)) < 1e-9, `film frame ${f}`);
  }
});

test("the measurer is asked once, for exactly the vendored fonts", () => {
  const seen: Parameters<ReturnType<typeof fakeMeasurer>>[0][] = [];
  emitRenderIr({ film: nativeSceneFilm(), format: "reel", svgSources: NATIVE_SVG_SOURCES, measure: fakeMeasurer(seen), resolvePath: (p) => `/repo/${p}` });
  assert.equal(seen.length, 1);
  assert.deepEqual([...new Set(seen[0].fonts.map((f) => f.path))].sort(), ["/repo/native/fonts/Geist-latin.ttf", "/repo/native/fonts/JetBrainsMono-latin.ttf"]);
  assert.ok(seen[0].runs.some((r) => r.text === "native"));
});

test("a film the native renderer cannot draw is refused with every reason", () => {
  const base = nativeSceneFilm();
  assert.deepEqual(nativeSupport(base, "long"), []);
  const unsupported = nativeSceneFilm({
    captions: "auto",
    subtitles: true,
    voiceover: { src: "videos/native-probe/voiceover.wav", volume: 1, words: [] },
    music: { src: "videos/native-probe/music.mp3", volume: 0.5 },
    shots: [{ ...base.shots[0], stage: "inset", blocks: [{ c: "Plot", points: [[0, 0], [1, 1]] }] }, ...base.shots.slice(1)],
  });
  const reasons = nativeSupport(unsupported, "long");
  assert.ok(reasons.some((r) => r.includes("music")), reasons.join("\n"));
  assert.ok(reasons.some((r) => r.includes('stage "inset"')), reasons.join("\n"));
  assert.ok(reasons.some((r) => r.includes("Plot blocks")), reasons.join("\n"));
  assert.throws(
    () => emitRenderIr({ film: unsupported, format: "long", svgSources: NATIVE_SVG_SOURCES, measure: fakeMeasurer(), resolvePath: (p) => p }),
    (e: unknown) => e instanceof NativeUnsupportedError && e.reasons.length === reasons.length,
  );
  const nodeGraph = nativeSceneFilm();
  delete (nodeGraph as { scene?: unknown }).scene;
  assert.ok(nativeSupport(nodeGraph, "reel").some((r) => r.includes("node-graph")));
  const three = nativeSceneFilm();
  (three.scene as { renderer?: string }).renderer = "three";
  assert.ok(nativeSupport(three, "long").some((r) => r.includes("Three-stage")));
  assert.equal(PROBE_SVG_SOURCE.startsWith("videos/"), true);
});

test("burned-in captions are emitted as the film's words with its per-shot placement, so a captioned film is no longer refused", () => {
  const base = nativeSceneFilm({ captions: "auto", subtitles: true });
  for (const format of ["long", "reel"] as const) {
    assert.deepEqual(nativeSupport(base, format), []);
    const ir = emit(base, format);
    const node = byId(ir, "captions");
    assert.equal(node.kind, "captions");
    if (node.kind !== "captions") return;
    const spoken = captionWordsForFilm(base);
    assert.ok(spoken.length > 0);
    const total = deliveryTimeline(base, format).totalFrames;
    assert.deepEqual(node.words, spoken.filter((w) => w.startFrame < total).map((w) => ({ text: w.text, startFrame: w.startFrame, endFrame: Math.min(total, w.endFrame) })));
    assert.equal(node.font, "geist-600");
    assert.equal(node.color, "#FFFFFF");
    assert.equal(node.highlightColor, "#635BFF");
    const size = Math.round(1080 * 0.042);
    assert.equal(node.placement[format]?.fontSize, size);
    assert.deepEqual(node.placement[format]?.spans, [{ fromFrame: 0, x: 0.5, y: 0.78 }]);
    // Captions draw above the rail and the end card and under the edge hairline, as Film.tsx orders them.
    const order = ir.overlay.map((n) => n.id);
    assert.ok(order.indexOf("captions") > order.indexOf("rail"));
    assert.equal(order[order.length - 1], "edge-hairline");
  }
});

test("a shot's own caption placement becomes a span from that shot's first frame, and only changes make spans", () => {
  const base = nativeSceneFilm({ captions: "auto", subtitles: true });
  const film = nativeSceneFilm({
    captions: "auto",
    subtitles: true,
    captionPlacement: { long: { x: 0.5, y: 0.7, locked: false } },
    shots: base.shots.map((s, i) => (i === 2 ? { ...s, captionPlacement: { long: { x: 0.3, y: 0.2, w: 0.5, locked: true } } } : s)),
  });
  const timeline = buildTimeline(film);
  const node = byId(emit(film, "long"), "captions");
  assert.equal(node.kind, "captions");
  if (node.kind !== "captions") return;
  const spans = node.placement.long?.spans ?? [];
  assert.equal(spans.length, 3);
  assert.deepEqual(spans[0], { fromFrame: 0, x: 0.5, y: 0.7 });
  assert.equal(spans[1].fromFrame, timeline[2].from);
  assert.equal(spans[1].x, 0.3);
  assert.equal(spans[1].y, 0.2);
  assert.ok(typeof spans[1].w === "number");
  assert.equal(spans[2].fromFrame, timeline[3].from);
  assert.deepEqual({ x: spans[2].x, y: spans[2].y }, { x: 0.5, y: 0.7 });
});

test("captions off or subtitles false emit no captions node", () => {
  assert.equal(nodes(emit(nativeSceneFilm()).overlay).some((n) => n.kind === "captions"), false);
  assert.equal(nodes(emit(nativeSceneFilm({ captions: "off", subtitles: true })).overlay).some((n) => n.kind === "captions"), false);
  assert.equal(nodes(emit(nativeSceneFilm({ captions: "auto", subtitles: false })).overlay).some((n) => n.kind === "captions"), false);
});
