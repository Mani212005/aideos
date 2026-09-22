/**
 * File Description: The design stage. Turns a parsed screenplay plus the measured narration timing
 * spine into a validated Film: one canvas node per screenplay section, one shot per narration beat,
 * on-screen copy as TextReveal blocks, and stage/move choices that satisfy the runsheet rules in
 * src/dl/schema.ts (no device holding past 25s, never the same device twice running, a text beat
 * and a return to the bare canvas inside every 90 seconds, at most three accents per frame).
 *
 * Shots map one-to-one onto narration beats on purpose: that is the only mapping under which a
 * shot's screen time can be its narration's measured duration, which is what keeps picture and
 * voice locked together instead of merely close.
 *
 * The async compile path selects each beat's visual strategy through the shared
 * Jev decision client (backend/jev.ts), then authors blocks validated against the film schema.
 */

import type { Block, CanvasEdge, CanvasNode, Film, Shot } from "../../src/dl/schema";
import { blockSchema, DEVICE_BLOCKS, parseFilm } from "../../src/dl/schema";
import { parseClaudeScript, type ScriptSegment } from "../scriptIntake";
import { generateRelationshipAwareCanvas, type ConceptEntity } from "../ideation/graphLayout";
import type { SegmentAudioInfo } from "../audio";
import { slugify } from "./filmStore";
import {
  selectShotVisual,
  type JevDecisionOptions,
  type ShotVisual,
  type ShotVisualResult,
} from "../jev";

/** One narration beat with the visual and on-screen directions that surround it. */
export interface NarrationBeat {
  /** Index of the screenplay section this beat belongs to. */
  sectionIndex: number;
  sectionId: string;
  sectionTitle: string;
  narration: string;
  visual?: string;
  onscreen: string[];
  /** True when the section's directions ask for generated footage. */
  wantsFootage: boolean;
}

/**
 * Slack between a shot and the clip that covers it.
 *
 * Generators quantise clip length - Wan2.1 snaps to 4k+1 frames at 16fps - so asking for exactly
 * the shot's duration reliably returns something a fraction of a second shorter, and the tail of
 * the shot renders black. Asking for a second more absorbs the quantisation with room to spare.
 */
export const FOOTAGE_HEADROOM_SEC = 1;

/** Marker a screenplay uses to request GPU B-roll for a beat. */
const FOOTAGE_MARKER = /\b(b-?roll|footage|live action|generated video|cinematic plate)\b/i;

/**
 * Flattens a screenplay into narration beats in document order.
 *
 * The order has to match backend/audio.ts's segmentation exactly, because beat i of this list is
 * what segment i of the synthesized narration speaks. Beats that carry no narration are dropped
 * for the same reason: they have no audio, so they cannot own screen time.
 */
export function flattenScreenplay(segments: ScriptSegment[]): NarrationBeat[] {
  const beats: NarrationBeat[] = [];

  segments.forEach((segment, sectionIndex) => {
    let pendingVisual: string | undefined;
    // A visual direction applies to the beat it introduces, not to every beat after it.
    // Without this the footage marker leaks down the section and flags shots the writer
    // never asked to cover, which is how B-roll ends up on the wrong words.
    let visualIsFresh = false;
    let pendingOnscreen: string[] = [];

    for (const beat of segment.beats) {
      if (beat.type === "visual") {
        pendingVisual = beat.text;
        visualIsFresh = true;
      } else if (beat.type === "onscreen") {
        pendingOnscreen.push(beat.text);
      } else {
        beats.push({
          sectionIndex,
          sectionId: segment.id,
          sectionTitle: segment.title,
          narration: beat.text,
          visual: pendingVisual,
          onscreen: pendingOnscreen,
          wantsFootage: visualIsFresh && Boolean(pendingVisual && FOOTAGE_MARKER.test(pendingVisual)),
        });
        pendingOnscreen = [];
        visualIsFresh = false;
      }
    }
  });

  return beats;
}

/** Trims on-screen copy to what the TextReveal schema accepts without mid-word truncation. */
function fitText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-]+$/, "");
}

/**
 * Picks the one word in a headline that carries the accent.
 *
 * The design language spends accent on meaning, so the choice is the longest content word rather
 * than the first: "a", "the" and "is" are never the point of a line.
 */
function pickAccentWord(text: string): string | undefined {
  const stop = new Set([
    "the", "and", "that", "this", "with", "from", "into", "your", "their", "then", "than",
    "what", "when", "which", "were", "have", "been", "will", "just", "only", "about", "every",
  ]);
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9-]/g, ""))
    .filter((w) => w.length > 3 && !stop.has(w.toLowerCase()));
  if (words.length === 0) return undefined;
  return words.reduce((best, w) => (w.length > best.length ? w : best));
}

/** A device block the pipeline decided a beat should carry, and what kind it is. */
interface DeviceChoice {
  block: Block;
  kind: string;
}

/** Reads the first number in a piece of narration together with the unit that follows it. */
function readQuantity(text: string): { value: number; suffix?: string; label: string } | null {
  const multiplier = text.match(/\b(two|three|four|five|ten|twenty|fifty|hundred|\d+(?:\.\d+)?)\s*(?:to\s+\w+\s*)?times\b/i);
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, ten: 10, twenty: 20, fifty: 50, hundred: 100 };
  if (multiplier) {
    const raw = multiplier[1].toLowerCase();
    const value = words[raw] ?? Number(raw);
    if (Number.isFinite(value)) return { value, suffix: "x", label: "Throughput gain" };
  }

  const scaled = text.match(/\b(\d+(?:\.\d+)?|seventy|eighty|ninety|sixty|fifty|forty|thirty|twenty|ten)\s+(billion|million|trillion|gigabytes|percent)\b/i);
  if (scaled) {
    const raw = scaled[1].toLowerCase();
    const numberWords: Record<string, number> = {
      ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    };
    const value = numberWords[raw] ?? Number(raw);
    const unit = scaled[2].toLowerCase();
    if (Number.isFinite(value)) {
      const suffix = unit === "percent" ? "%" : unit === "gigabytes" ? " GB" : unit.charAt(0).toUpperCase();
      return { value, suffix, label: unit === "gigabytes" ? "Moved per token" : "Parameters" };
    }
  }
  return null;
}

/**
 * Decides whether a beat earns a device, and which one.
 *
 * The design language treats a device as an argument the frame is making, not decoration, so the
 * rules only fire where the narration actually carries the data the device would show. The
 * runsheet's "never the same device twice running" rule is enforced here rather than discovered
 * at validation time.
 */
function chooseDevice(narration: string, onscreen: string[], lastDeviceKind: string | null): DeviceChoice | null {
  const lower = narration.toLowerCase();
  // A device is the second half of a composed frame, not the whole of one. Without a headline
  // to sit under, a single small device floats alone in a full-frame panel and reads as an
  // empty station, so a beat with no on-screen copy stays on the canvas instead.
  if (onscreen.length === 0) return null;

  const candidates: DeviceChoice[] = [];

  const quantity = readQuantity(narration);
  if (quantity) {
    candidates.push({
      kind: "StatCounter",
      block: {
        c: "StatCounter",
        to: quantity.value,
        label: fitText(quantity.label, 44),
        format: quantity.value >= 1000 ? "compact" : "plain",
        ...(quantity.suffix ? { suffix: quantity.suffix } : {}),
      },
    });
  }

  const parallelCheck = /\b(in parallel|at once|all five|batch of them|single forward pass|tokens?|sequence|stream)\b/.test(lower);
  if (parallelCheck) {
    candidates.push({
      kind: "TokenStrip",
      block: {
        c: "TokenStrip",
        tokens: ["t+1", "t+2", "t+3", "t+4", "t+5"],
        lit: [0, 1, 2],
        caption: "Accepted token sequence",
      },
    });
  }

  const growthTalk = /\b(scales?|scaling|grows?|throughput|linear|quadratic|loss|accuracy|curve)\b/.test(lower);
  if (growthTalk) {
    candidates.push({
      kind: "Plot",
      block: {
        c: "Plot",
        points: [
          [0, 0.08],
          [0.25, 0.2],
          [0.5, 0.38],
          [0.75, 0.62],
          [1, 0.92],
        ],
        xLabel: "draft length",
        yLabel: "throughput",
        endLabel: "accepted",
      },
    });
  }

  const matrixTalk = /\b(matrix|weights?|tensor|grid|attention map|embedding space|heat\s*map|table)\b/.test(lower);
  if (matrixTalk) {
    candidates.push({
      kind: "MatrixGrid",
      block: {
        c: "MatrixGrid",
        sweep: "cell",
        rowLabel: "tokens",
        colLabel: "heads",
        values: [
          [0.9, 0.2, 0.1, 0.4],
          [0.1, 0.85, 0.3, 0.2],
          [0.3, 0.1, 0.95, 0.1],
          [0.2, 0.4, 0.1, 0.88],
        ],
      },
    });
  }

  const distributionTalk = /\b(distribution|probability|proportions?|breakdown|fraction|shares?|split|weights?)\b/.test(lower);
  if (distributionTalk) {
    candidates.push({
      kind: "Distribution",
      block: {
        c: "Distribution",
        items: [
          { label: "Direct Path", p: 0.62 },
          { label: "Fallback", p: 0.28 },
          { label: "Residual", p: 0.1 },
        ],
      },
    });
  }

  const layerTalk = /\b(layers?|stack|tier|hierarchy|pipeline|stages?|deep network|blocks?)\b/.test(lower);
  if (layerTalk) {
    candidates.push({
      kind: "LayerStack",
      block: {
        c: "LayerStack",
        layers: ["Input Layer", "Processing Block x12", "Output Projection"],
      },
    });
  }

  const scaleTalk = /\b(threshold|trade-off|spectrum|slider|range|bounds?|limits?|temperature)\b/.test(lower);
  if (scaleTalk) {
    candidates.push({
      kind: "ScaleBar",
      block: {
        c: "ScaleBar",
        ticks: ["Min", "Balanced", "Peak"],
        value: 0.72,
        label: "Optimal threshold",
      },
    });
  }

  const eligible = candidates.filter((c) => c.kind !== lastDeviceKind);
  return eligible.length > 0 ? eligible[0] : null;
}

/** Builds the blocks a text beat shows: a headline, and a supporting line when one was written. */
function buildTextBlocks(onscreen: string[]): Block[] {
  const blocks: Block[] = [];
  const headline = fitText(onscreen[0] ?? "", 90);
  if (!headline) return blocks;

  const accentWord = pickAccentWord(headline);
  blocks.push({
    c: "TextReveal",
    text: headline,
    size: headline.length <= 34 ? "display" : "headline",
    ...(accentWord ? { accentWord } : {}),
  });

  const support = fitText(onscreen.slice(1).join(" "), 170);
  if (support) blocks.push({ c: "Body", text: support });
  return blocks;
}

/** Options that let a caller steer pacing without reaching into the compiler. */
export interface DesignOptions {
  title: string;
  slug?: string;
  fps?: 24 | 30 | 60;
  /** Longest a generated B-roll clip may run, which bounds which beats can carry footage. */
  maxFootageSec?: number;
  /** Upper bound on how many beats get flagged for footage. */
  maxFootageShots?: number;
  music?: { src: string; volume?: number; duckUnderVoiceover?: boolean };
}

/** Beats flagged for footage, in the order the B-roll stage should render them. */
export interface FootageRequest {
  shotId: string;
  prompt: string;
  seconds: number;
}

/** What the design stage produces: the film plus the footage jobs it asks for. */
export interface DesignResult {
  film: Film;
  footage: FootageRequest[];
}

/** What the async Jev-driven compile produces beyond the sync film and footage. */
export interface AsyncDesignResult extends DesignResult {
  shotVisuals: Map<string, ShotVisualResult>;
}

/**
 * Chooses which beats carry generated footage.
 *
 * A beat qualifies only if its narration fits inside one clip - a clip shorter than its shot
 * leaves the frame black for the remainder, which is worse than no B-roll at all. Beats the
 * screenplay explicitly asked for come first; the rest of the budget goes to the longest
 * remaining beats that still fit, spread across the film rather than bunched together.
 */
function chooseFootageBeats(
  beats: NarrationBeat[],
  durations: number[],
  maxFootageSec: number,
  maxFootageShots: number,
): number[] {
  const eligible = beats
    .map((beat, i) => ({ beat, i, dur: durations[i] }))
    .filter(({ dur }) => dur > 2 && dur + FOOTAGE_HEADROOM_SEC <= maxFootageSec);

  const requested = eligible.filter(({ beat }) => beat.wantsFootage).map(({ i }) => i);
  const filteredRequested: number[] = [];
  for (const i of requested) {
    if (filteredRequested.length === 0 || i - filteredRequested[filteredRequested.length - 1] > 1) {
      filteredRequested.push(i);
    }
  }

  if (filteredRequested.length >= maxFootageShots) return filteredRequested.slice(0, maxFootageShots).sort((a, b) => a - b);

  const chosen = new Set(filteredRequested);
  const spacing = Math.max(2, Math.floor(beats.length / Math.max(1, maxFootageShots)));
  for (const { i } of eligible) {
    if (chosen.size >= maxFootageShots) break;
    if (chosen.has(i)) continue;
    // Keep footage beats apart so the film does not turn into back-to-back video clips or back-to-back AnalogyInsets.
    if ([...chosen].some((other) => Math.abs(other - i) < spacing)) continue;
    chosen.add(i);
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * Lays the argument out as a serpentine grid rather than one long row.
 *
 * A single row of eight nodes is a 6:1 strip: framing all of it fills a third of a 16:9 frame and
 * almost nothing of a 9:16 one. Wrapping every third node keeps the map's bounding box near 16:9,
 * so a wide shot reads in the long form and still fills a useful band of the reel. Rows alternate
 * direction so the reading order stays continuous, which is what the connecting edges draw.
 */
function layoutCanvas(concepts: ConceptEntity[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  if (concepts.length <= 2) return generateRelationshipAwareCanvas(concepts);

  const columns = concepts.length <= 4 ? 2 : 3;
  // Sized for what a node actually holds: a category tag, a title that may wrap to two
  // lines at this width, and a sub-label under it.
  const nodeWidth = 280;
  const nodeHeight = 124;
  const gapX = 150;
  const gapY = 150;

  const nodes: CanvasNode[] = concepts.map((concept, i) => {
    const row = Math.floor(i / columns);
    const indexInRow = i % columns;
    const column = row % 2 === 0 ? indexInRow : columns - 1 - indexInRow;
    return {
      id: concept.id,
      label: concept.label.slice(0, 28),
      ...(concept.sub ? { sub: concept.sub.slice(0, 34) } : {}),
      x: 160 + column * (nodeWidth + gapX),
      y: 200 + row * (nodeHeight + gapY),
      w: nodeWidth,
      h: nodeHeight,
    };
  });

  const edges: CanvasEdge[] = nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id, dashed: false }));
  return { nodes, edges };
}

/**
 * The group of nodes a spine shot pulls back to take in.
 */
function spineLook(nodes: CanvasNode[], index: number, reach: number): string[] {
  const picked: CanvasNode[] = [];
  for (let offset = -reach; offset <= reach; offset++) {
    picked.push(nodes[Math.min(nodes.length - 1, Math.max(0, index + offset))]);
  }

  const spansRows = new Set(picked.map((n) => n.y)).size > 1;
  if (!spansRows) {
    const otherRow = nodes.find((n) => n.y !== nodes[index].y && Math.abs(n.x - nodes[index].x) < nodes[index].w);
    if (otherRow) picked.push(otherRow);
  }

  return [...new Set(picked.map((n) => n.id))];
}

/**
 * Compiles a screenplay and its measured narration into a validated film.
 *
 * The runsheet rules are satisfied by construction rather than by retrying against the validator:
 * the stage of each shot is chosen while walking the timeline with the clock the rules are written
 * against, so a text beat and a canvas return are placed before either deadline can be missed.
 */
export function compileFilmFromScreenplay(
  script: string,
  narration: SegmentAudioInfo[],
  shotDurations: number[],
  options: DesignOptions,
): DesignResult {
  const sections = parseClaudeScript(script);
  const beats = flattenScreenplay(sections);

  if (beats.length !== narration.length) {
    throw new Error(
      `screenplay has ${beats.length} narration beat(s) but ${narration.length} were synthesized; ` +
        "the design stage cannot map shots onto audio that does not correspond to it",
    );
  }

  const slug = options.slug ?? slugify(options.title);
  const fps = options.fps ?? 30;
  const maxFootageSec = options.maxFootageSec ?? 8;
  const maxFootageShots = options.maxFootageShots ?? 4;

  const MAX_CHAPTERS = 12;
  const MAX_NODES = 24;

  const usedSections = [...new Set(beats.map((b) => b.sectionIndex))].sort((a, b) => a - b);

  // Chapter clustering to guarantee chapters <= 12
  let chapterNames: string[];
  const chapterIndexBySection = new Map<number, number>();

  if (usedSections.length <= MAX_CHAPTERS) {
    chapterNames = usedSections.map((sIdx, i) => fitText(sections[sIdx]?.title || `Chapter ${i + 1}`, 30));
    usedSections.forEach((sIdx, i) => chapterIndexBySection.set(sIdx, i));
  } else {
    chapterNames = [];
    for (let c = 0; c < MAX_CHAPTERS; c++) {
      const startIdx = Math.floor((c * usedSections.length) / MAX_CHAPTERS);
      const sIdx = usedSections[startIdx];
      chapterNames.push(fitText(sections[sIdx]?.title || `Part ${c + 1}`, 30));
    }
    usedSections.forEach((sIdx, i) => {
      const cIdx = Math.min(MAX_CHAPTERS - 1, Math.floor((i * MAX_CHAPTERS) / usedSections.length));
      chapterIndexBySection.set(sIdx, cIdx);
    });
  }

  // Ensure unique chapter strings
  const uniqueChapters: string[] = [];
  chapterNames.forEach((name, i) => {
    let clean = name || `Chapter ${i + 1}`;
    if (uniqueChapters.includes(clean)) {
      clean = `${clean.slice(0, 26)} ${i + 1}`;
    }
    uniqueChapters.push(clean.slice(0, 30));
  });

  // Canvas nodes clustering to guarantee 2 <= nodes <= 24
  let concepts: ConceptEntity[];
  const nodeIdBySection = new Map<number, string>();

  if (usedSections.length <= MAX_NODES) {
    concepts = usedSections.map((sectionIndex, i) => {
      const section = sections[sectionIndex];
      const firstBeat = beats.find((b) => b.sectionIndex === sectionIndex);
      return {
        id: section.id || `section-${i + 1}`,
        label: fitText(section.title || `Part ${i + 1}`, 28),
        sub: firstBeat?.onscreen[0] ? fitText(firstBeat.onscreen[0], 34) : undefined,
        chapterIndex: chapterIndexBySection.get(sectionIndex) ?? 0,
        relationship: "sequential" as const,
      };
    });
    if (concepts.length === 1) {
      concepts.push({
        id: "summary-node",
        label: "Summary",
        sub: "Key Takeaways",
        chapterIndex: 0,
        relationship: "sequential" as const,
      });
    }
    usedSections.forEach((sIdx, i) => nodeIdBySection.set(sIdx, concepts[i].id));
  } else {
    concepts = [];
    for (let n = 0; n < MAX_NODES; n++) {
      const startIdx = Math.floor((n * usedSections.length) / MAX_NODES);
      const sIdx = usedSections[startIdx];
      const section = sections[sIdx];
      const firstBeat = beats.find((b) => b.sectionIndex === sIdx);
      concepts.push({
        id: `node-${n + 1}`,
        label: fitText(section?.title || `Node ${n + 1}`, 28),
        sub: firstBeat?.onscreen[0] ? fitText(firstBeat.onscreen[0], 34) : undefined,
        chapterIndex: chapterIndexBySection.get(sIdx) ?? 0,
        relationship: "sequential" as const,
      });
    }
    usedSections.forEach((sIdx, i) => {
      const nIdx = Math.min(MAX_NODES - 1, Math.floor((i * MAX_NODES) / usedSections.length));
      nodeIdBySection.set(sIdx, concepts[nIdx].id);
    });
  }

  const { nodes, edges } = layoutCanvas(concepts);
  const nodeIds = nodes.map((n) => n.id);

  const footageIndices = new Set(
    chooseFootageBeats(beats, shotDurations, maxFootageSec, maxFootageShots),
  );

  const shots: Shot[] = [];
  const footage: FootageRequest[] = [];
  let sinceTextBeat = 0;
  let sinceCanvas = 0;
  let lastChapterIdx = -1;
  let lastDeviceKind: string | null = null;
  let consecutiveSpine = 0;
  let devicesUsed = 0;
  const maxDevices = Math.max(2, Math.round(beats.length / 4));

  beats.forEach((beat, i) => {
    const dur = shotDurations[i];
    const chapterIdx = chapterIndexBySection.get(beat.sectionIndex) ?? 0;
    const isChapterStart = chapterIdx !== lastChapterIdx;
    lastChapterIdx = chapterIdx;

    const nodeId = nodeIdBySection.get(beat.sectionIndex) ?? nodeIds[0];
    const nodeIndex = Math.max(0, nodeIds.indexOf(nodeId));

    const textBlocks = buildTextBlocks(beat.onscreen);
    const wantsFootage = footageIndices.has(i);

    // Runsheet timing boundaries: 70s threshold leaves room before the 90s schema limit.
    const textBeatDue = sinceTextBeat + dur > 70;
    const canvasDue = sinceCanvas + dur > 70;

    const device =
      !wantsFootage && dur >= 4 && dur <= 25 && devicesUsed < maxDevices && !canvasDue
        ? chooseDevice(beat.narration, beat.onscreen, lastDeviceKind)
        : null;

    let stage: Shot["stage"];
    let blocks: Block[];

    if (wantsFootage) {
      stage = "frame";
      blocks = [
        {
          c: "AnalogyInset",
          caption: fitText(beat.onscreen[0] || beat.sectionTitle, 80) || "B-roll",
          fullScreenHero: true,
        },
      ];
      lastDeviceKind = "AnalogyInset";
    } else if (device) {
      stage = "anchor";
      blocks = [...textBlocks.slice(0, 1), device.block];
      lastDeviceKind = device.kind;
      devicesUsed += 1;
    } else if (textBlocks.length > 0 && (isChapterStart || textBeatDue || !canvasDue)) {
      stage = "frame";
      blocks = textBlocks;
      lastDeviceKind = null;
    } else {
      stage = "none";
      blocks = [];
      lastDeviceKind = null;
    }

    consecutiveSpine = stage === "none" ? consecutiveSpine + 1 : 0;
    const look: Shot["look"] =
      stage === "none" ? spineLook(nodes, nodeIndex, Math.min(3, consecutiveSpine)) : nodeId;
    const zoom =
      stage === "none" ? Math.max(0.6, 1 - 0.1 * consecutiveSpine) : stage === "anchor" ? 1.05 : 1;
    const move: Shot["move"] = i === 0 || isChapterStart ? "cut" : stage === "none" ? "zoom-out" : "pan";

    shots.push({
      id: `beat-${String(i + 1).padStart(2, "0")}`,
      ch: uniqueChapters[chapterIdx],
      dur: Number(dur.toFixed(3)),
      stage,
      look,
      move,
      drift: true,
      zoom,
      scriptText: beat.narration,
      ...(beat.visual ? { visualDirection: beat.visual } : {}),
      ...(wantsFootage ? { needsFootage: true } : {}),
      blocks,
    });

    if (wantsFootage) {
      footage.push({
        shotId: shots[shots.length - 1].id,
        prompt: beat.visual || beat.narration,
        seconds: Math.min(maxFootageSec, Math.max(3, dur + FOOTAGE_HEADROOM_SEC)),
      });
    }

    sinceTextBeat = stage === "frame" ? 0 : sinceTextBeat + dur;
    sinceCanvas = stage === "none" ? 0 : sinceCanvas + dur;
  });

  const totalSec = shotDurations.reduce((a, b) => a + b, 0);
  const film = parseFilm({
    id: slug,
    title: options.title,
    fps,
    accent: "#635BFF",
    theme: { background: "smooth-dark", fontFamily: "geist", accent: "#635BFF" },
    chapters: uniqueChapters,
    canvas: { nodes, edges },
    shots,
    voiceover: { src: `videos/${slug}/voiceover.wav`, volume: 1, durationSec: totalSec },
    captions: `videos/${slug}/captions.vtt`,
    ...(options.music ? { music: options.music } : {}),
  });

  return { film, footage };
}

// Builds schema-valid blocks for one Jev-chosen shot visual strategy.
export function buildBlocksForShotVisual(
  visual: ShotVisual,
  narration: string,
  onscreen: string[],
): Block[] {
  const candidates: Block[] = [];
  if (visual === "Text") {
    return buildTextBlocks(onscreen);
  }
  const headline = onscreen[0] ? fitText(onscreen[0], 90) : "";
  if (headline) {
    const accentWord = pickAccentWord(headline);
    candidates.push({
      c: "TextReveal",
      text: headline,
      size: headline.length <= 34 ? "display" : "headline",
      ...(accentWord ? { accentWord } : {}),
    });
  }
  const device = chooseDevice(narration, onscreen, null);
  let chosen: Block | null = null;
  if (device && device.kind.toLowerCase() === visual.toLowerCase()) {
    chosen = device.block;
  } else {
    const byKind = chooseDeviceForVisual(visual, narration, onscreen);
    if (byKind) chosen = byKind;
  }
  if (chosen) candidates.push(chosen);
  if (candidates.length === 0) {
    return buildTextBlocks(onscreen);
  }
  const valid: Block[] = [];
  for (const block of candidates.slice(0, 2)) {
    const parsed = blockSchema.safeParse(block);
    if (parsed.success) valid.push(parsed.data);
  }
  if (valid.length === 0) {
    return buildTextBlocks(onscreen);
  }
  return valid;
}

// Builds one device block for an explicit visual strategy without regex re-matching.
function chooseDeviceForVisual(visual: ShotVisual, narration: string, onscreen: string[]): Block | null {
  const quantity = readQuantity(narration);
  switch (visual) {
    case "StatCounter":
      if (quantity) {
        return {
          c: "StatCounter",
          to: quantity.value,
          label: fitText(quantity.label, 44),
          format: quantity.value >= 1000 ? "compact" : "plain",
          ...(quantity.suffix ? { suffix: quantity.suffix } : {}),
        };
      }
      return {
        c: "StatCounter",
        to: 100,
        label: fitText(onscreen[0] || "Key Metric", 44),
        format: "plain",
      };
    case "TokenStrip":
      return {
        c: "TokenStrip",
        tokens: ["t+1", "t+2", "t+3", "t+4", "t+5"],
        lit: [0, 1, 2],
        caption: "Accepted token sequence",
      };
    case "Plot":
      return {
        c: "Plot",
        points: [
          [0, 0.08],
          [0.25, 0.2],
          [0.5, 0.38],
          [0.75, 0.62],
          [1, 0.92],
        ],
        xLabel: "draft length",
        yLabel: "throughput",
        endLabel: "accepted",
      };
    case "MatrixGrid":
      return {
        c: "MatrixGrid",
        sweep: "cell",
        rowLabel: "tokens",
        colLabel: "heads",
        values: [
          [0.9, 0.2, 0.1, 0.4],
          [0.1, 0.85, 0.3, 0.2],
          [0.3, 0.1, 0.95, 0.1],
          [0.2, 0.4, 0.1, 0.88],
        ],
      };
    case "Distribution":
      return {
        c: "Distribution",
        items: [
          { label: "Direct Path", p: 0.62 },
          { label: "Fallback", p: 0.28 },
          { label: "Residual", p: 0.1 },
        ],
      };
    case "LayerStack":
      return {
        c: "LayerStack",
        layers: ["Input Layer", "Processing Block x12", "Output Projection"],
      };
    case "ScaleBar":
      return {
        c: "ScaleBar",
        ticks: ["Min", "Balanced", "Peak"],
        value: 0.72,
        label: "Optimal threshold",
      };
    default:
      return null;
  }
}

// Compiles a screenplay plus narration spine into a film using Jev shot-visual choice.
export async function compileFilmFromScreenplayAsync(
  script: string,
  narration: SegmentAudioInfo[],
  shotDurations: number[],
  options: DesignOptions,
  jevOptions?: JevDecisionOptions,
): Promise<AsyncDesignResult> {
  const sections = parseClaudeScript(script);
  const beats = flattenScreenplay(sections);
  if (beats.length !== narration.length) {
    throw new Error(
      `screenplay has ${beats.length} narration beat(s) but ${narration.length} were synthesized; ` +
        "the design stage cannot map shots onto audio that does not correspond to it",
    );
  }
  const slug = options.slug ?? slugify(options.title);
  const fps = options.fps ?? 30;
  const maxFootageSec = options.maxFootageSec ?? 8;
  const maxFootageShots = options.maxFootageShots ?? 4;
  const MAX_CHAPTERS = 12;
  const MAX_NODES = 24;
  const usedSections = [...new Set(beats.map((b) => b.sectionIndex))].sort((a, b) => a - b);
  let chapterNames: string[];
  const chapterIndexBySection = new Map<number, number>();
  if (usedSections.length <= MAX_CHAPTERS) {
    chapterNames = usedSections.map((sIdx, i) => fitText(sections[sIdx]?.title || `Chapter ${i + 1}`, 30));
    usedSections.forEach((sIdx, i) => chapterIndexBySection.set(sIdx, i));
  } else {
    chapterNames = [];
    for (let c = 0; c < MAX_CHAPTERS; c++) {
      const startIdx = Math.floor((c * usedSections.length) / MAX_CHAPTERS);
      const sIdx = usedSections[startIdx];
      chapterNames.push(fitText(sections[sIdx]?.title || `Part ${c + 1}`, 30));
    }
    usedSections.forEach((sIdx, i) => {
      const cIdx = Math.min(MAX_CHAPTERS - 1, Math.floor((i * MAX_CHAPTERS) / usedSections.length));
      chapterIndexBySection.set(sIdx, cIdx);
    });
  }
  const uniqueChapters: string[] = [];
  chapterNames.forEach((name, i) => {
    let clean = name || `Chapter ${i + 1}`;
    if (uniqueChapters.includes(clean)) {
      clean = `${clean.slice(0, 26)} ${i + 1}`;
    }
    uniqueChapters.push(clean.slice(0, 30));
  });
  let concepts: ConceptEntity[];
  const nodeIdBySection = new Map<number, string>();
  if (usedSections.length <= MAX_NODES) {
    concepts = usedSections.map((sectionIndex, i) => {
      const section = sections[sectionIndex];
      const firstBeat = beats.find((b) => b.sectionIndex === sectionIndex);
      return {
        id: section.id || `section-${i + 1}`,
        label: fitText(section.title || `Part ${i + 1}`, 28),
        sub: firstBeat?.onscreen[0] ? fitText(firstBeat.onscreen[0], 34) : undefined,
        chapterIndex: chapterIndexBySection.get(sectionIndex) ?? 0,
        relationship: "sequential" as const,
      };
    });
    if (concepts.length === 1) {
      concepts.push({
        id: "summary-node",
        label: "Summary",
        sub: "Key Takeaways",
        chapterIndex: 0,
        relationship: "sequential" as const,
      });
    }
    usedSections.forEach((sIdx, i) => nodeIdBySection.set(sIdx, concepts[i].id));
  } else {
    concepts = [];
    for (let n = 0; n < MAX_NODES; n++) {
      const startIdx = Math.floor((n * usedSections.length) / MAX_NODES);
      const sIdx = usedSections[startIdx];
      const section = sections[sIdx];
      const firstBeat = beats.find((b) => b.sectionIndex === sIdx);
      concepts.push({
        id: `node-${n + 1}`,
        label: fitText(section?.title || `Node ${n + 1}`, 28),
        sub: firstBeat?.onscreen[0] ? fitText(firstBeat.onscreen[0], 34) : undefined,
        chapterIndex: chapterIndexBySection.get(sIdx) ?? 0,
        relationship: "sequential" as const,
      });
    }
    usedSections.forEach((sIdx, i) => {
      const nIdx = Math.min(MAX_NODES - 1, Math.floor((i * MAX_NODES) / usedSections.length));
      nodeIdBySection.set(sIdx, concepts[nIdx].id);
    });
  }
  const { nodes, edges } = layoutCanvas(concepts);
  const nodeIds = nodes.map((n) => n.id);
  const footageIndices = new Set(chooseFootageBeats(beats, shotDurations, maxFootageSec, maxFootageShots));
  const shots: Shot[] = [];
  const footage: FootageRequest[] = [];
  const shotVisuals = new Map<string, ShotVisualResult>();
  let sinceTextBeat = 0;
  let sinceCanvas = 0;
  let lastChapterIdx = -1;
  let lastDeviceKind: string | null = null;
  let consecutiveSpine = 0;
  let devicesUsed = 0;
  const maxDevices = Math.max(2, Math.round(beats.length / 4));
  const activeVisuals: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const dur = shotDurations[i];
    const chapterIdx = chapterIndexBySection.get(beat.sectionIndex) ?? 0;
    const isChapterStart = chapterIdx !== lastChapterIdx;
    lastChapterIdx = chapterIdx;
    const nodeId = nodeIdBySection.get(beat.sectionIndex) ?? nodeIds[0];
    const nodeIndex = Math.max(0, nodeIds.indexOf(nodeId));
    const textBlocks = buildTextBlocks(beat.onscreen);
    const wantsFootage = footageIndices.has(i);
    const textBeatDue = sinceTextBeat + dur > 70;
    const canvasDue = sinceCanvas + dur > 70;
    const shotId = `beat-${String(i + 1).padStart(2, "0")}`;
    const visualState = {
      visual: beat.visual,
      narration: beat.narration,
      onscreen: beat.onscreen,
      activeVisuals: [...activeVisuals],
      sceneTitle: beat.sectionTitle,
      durationSec: dur,
      wantsFootage,
    };
    const visualDecision = await selectShotVisual(visualState, jevOptions);
    shotVisuals.set(shotId, visualDecision);
    let stage: Shot["stage"];
    let blocks: Block[];
    if (wantsFootage) {
      stage = "frame";
      blocks = [
        {
          c: "AnalogyInset",
          caption: fitText(beat.onscreen[0] || beat.sectionTitle, 80) || "B-roll",
          fullScreenHero: true,
        },
      ];
    } else {
      const choice = visualDecision.visual;
      const deviceEligible =
        dur >= 4 && dur <= 25 && devicesUsed < maxDevices && !canvasDue && choice !== "Text";
      const repeatsLast = lastDeviceKind !== null && choice.toLowerCase() === lastDeviceKind.toLowerCase();
      if (deviceEligible && !repeatsLast) {
        stage = "anchor";
        blocks = buildBlocksForShotVisual(choice, beat.narration, beat.onscreen);
        if (blocks.some((b) => (["StatCounter", "TokenStrip", "Plot", "MatrixGrid", "Distribution", "LayerStack", "ScaleBar"] as string[]).includes(b.c))) {
          devicesUsed += 1;
          activeVisuals.push(choice);
        }
      } else if (textBlocks.length > 0 && (isChapterStart || textBeatDue || !canvasDue)) {
        stage = "frame";
        blocks = textBlocks;
      } else {
        stage = "none";
        blocks = [];
      }
    }
    // Mirror the schema's device rotation: only a DEVICE_BLOCKS entry sets it, a frame or spine
    // shot resets it, and an anchor shot without one (StatCounter) leaves it alone.
    // A footage AnalogyInset may follow any beat, so a device-less anchor right after one is
    // staged as a frame to reset the rotation instead of chaining AnalogyInset into itself.
    const schemaDevice = blocks.find((b) => (DEVICE_BLOCKS as readonly string[]).includes(b.c))?.c ?? null;
    if (!schemaDevice && stage === "anchor" && lastDeviceKind === "AnalogyInset") stage = "frame";
    lastDeviceKind = schemaDevice ?? (stage === "anchor" ? lastDeviceKind : null);
    if (activeVisuals.length > 8) activeVisuals.shift();
    consecutiveSpine = stage === "none" ? consecutiveSpine + 1 : 0;
    const look: Shot["look"] =
      stage === "none" ? spineLook(nodes, nodeIndex, Math.min(3, consecutiveSpine)) : nodeId;
    const zoom =
      stage === "none" ? Math.max(0.6, 1 - 0.1 * consecutiveSpine) : stage === "anchor" ? 1.05 : 1;
    const move: Shot["move"] = i === 0 || isChapterStart ? "cut" : stage === "none" ? "zoom-out" : "pan";
    shots.push({
      id: shotId,
      ch: uniqueChapters[chapterIdx],
      dur: Number(dur.toFixed(3)),
      stage,
      look,
      move,
      drift: true,
      zoom,
      scriptText: beat.narration,
      ...(beat.visual ? { visualDirection: beat.visual } : {}),
      ...(wantsFootage ? { needsFootage: true } : {}),
      blocks,
    });
    if (wantsFootage) {
      footage.push({
        shotId,
        prompt: beat.visual || beat.narration,
        seconds: Math.min(maxFootageSec, Math.max(3, dur + FOOTAGE_HEADROOM_SEC)),
      });
    }
    sinceTextBeat = stage === "frame" ? 0 : sinceTextBeat + dur;
    sinceCanvas = stage === "none" ? 0 : sinceCanvas + dur;
  }
  const totalSec = shotDurations.reduce((a, b) => a + b, 0);
  const film = parseFilm({
    id: slug,
    title: options.title,
    fps,
    accent: "#635BFF",
    theme: { background: "smooth-dark", fontFamily: "geist", accent: "#635BFF" },
    chapters: uniqueChapters,
    canvas: { nodes, edges },
    shots,
    voiceover: { src: `videos/${slug}/voiceover.wav`, volume: 1, durationSec: totalSec },
    captions: `videos/${slug}/captions.vtt`,
    ...(options.music ? { music: options.music } : {}),
  });
  return { film, footage, shotVisuals };
}
