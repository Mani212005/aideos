/**
 * File Description: Model-authored data for the design stage's chart devices.
 * Jev picks what kind of chart a beat gets; this module has a text model write that chart's
 * contents (the tokens, the bars, the axis names) from the beat's own narration, in one batched
 * request per film, and then checks every authored block before it can reach the screen: it must
 * parse against the film schema, and every word and number it shows must come from what the beat
 * says. A block that fails is dropped and the beat keeps its text card, so a film never shows
 * made-up data - there are no canned stand-ins.
 */

import { blockSchema, type Block } from "../../src/dl/schema";
import { SHOT_COMPLEX_VISUALS, type ShotVisual } from "../jev";
import { numbersIn } from "../shotVisualCues";

/** Chart devices whose contents are authored (StatCounter is read straight from the narration). */
export const AUTHORED_DEVICES = SHOT_COMPLEX_VISUALS.filter((v) => v !== "StatCounter") as ShotVisual[];

/** One beat whose chart data is wanted, and the chart kinds it may be drawn as. */
export interface DeviceRequest {
  key: string;
  narration: string;
  onscreen: string[];
  sceneTitle?: string;
  kinds: ShotVisual[];
}

/** Sends one prompt to a text model and returns its raw reply. */
export type DeviceLlmCaller = (prompt: string, systemInstruction: string) => Promise<string>;

/** What happened to one beat's authored chart, kept so the studio can explain the choice. */
export interface DeviceReport {
  kind: ShotVisual;
  state: "authored" | "refused" | "not-authored";
  reason?: string;
}

/** The checked blocks for every request, keyed `${key}:${kind}`, plus a report for each refusal. */
export interface AuthoredDevices {
  blocks: Map<string, Block>;
  refusals: Map<string, string>;
}

const SHAPES: Record<string, string> = {
  TokenStrip: `{"c":"TokenStrip","tokens":[3-16 strings, each 1-14 chars],"lit":[indices already produced],"caption":"<=60 chars"}`,
  Plot: `{"c":"Plot","points":[[x,y] 2-24 pairs in 0..1, origin bottom-left],"xLabel":"<=16","yLabel":"<=16","endLabel":"<=16"}`,
  MatrixGrid: `{"c":"MatrixGrid","values":[2-8 rows of 2-10 numbers in 0..1],"rowLabel":"<=18","colLabel":"<=18","valueLabel":"<=18","sweep":"row"|"cell"}`,
  Distribution: `{"c":"Distribution","items":[2-6 {"label":"<=16","p":0..1}],"prompt":"<=80, ___ marks the blank","note":"<=60"}`,
  LayerStack: `{"c":"LayerStack","layers":[2-6 short labels, bottom first],"bottomLabel":"<=22","topLabel":"<=22"}`,
  ScaleBar: `{"c":"ScaleBar","ticks":[2-6 labels, each <=8 chars],"value":0..1,"label":"<=20"}`,
};

const SYSTEM = `You write the data for small animated explainer charts. Every chart illustrates exactly what one narrated sentence says.
Rules:
- Every label, token, tick and caption uses words that are in that beat's narration, on-screen copy or scene title. Never invent names, categories or numbers.
- A number may appear only if the narration says it. Shapes (curve points, grid values, shares that the narration describes only in words) are illustrative and may be chosen to match the described trend.
- Keep labels short and plain. Title case is fine. Respect every length limit in the shapes exactly.
- Leave out optional fields you have nothing for rather than sending null.
- If the narration does not carry enough to draw a kind honestly, return null for it.
Reply with only a JSON object, no prose.`;

// Renders the batched authoring prompt for every request.
export function renderDevicePrompt(requests: DeviceRequest[]): string {
  const kinds = [...new Set(requests.flatMap((r) => r.kinds))];
  const beats = requests.map((r) => ({
    key: r.key,
    narration: r.narration,
    onscreen: r.onscreen,
    ...(r.sceneTitle ? { sceneTitle: r.sceneTitle } : {}),
    kinds: r.kinds,
  }));
  return `Chart shapes:
${kinds.map((k) => `- ${k}: ${SHAPES[k]}`).join("\n")}

Beats:
${JSON.stringify(beats, null, 2)}

Reply as {"<key>": {"<kind>": <chart object or null>, ...}, ...} covering every beat and every kind listed for it.`;
}

const STOP = new Set(
  "the a an of to in on at by for with and or but is are was were be been it its this that these those as from into than then so each every per one our we you they their there here what which who how".split(" "),
);
// Generic chart words a label may use without the narration saying them.
const CHART_WORDS = new Set("low high min max more less time step steps input output value share rest other total".split(" "));

// Splits text into lowercase words.
function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
}

// True when two words share a stem (the first five letters, or all of a shorter word).
function sameStem(a: string, b: string): boolean {
  const n = Math.min(5, a.length, b.length);
  return n >= 3 ? a.slice(0, n) === b.slice(0, n) && Math.abs(a.length - b.length) <= 4 : a === b;
}

// Lists every piece of text an authored block would put on screen.
function shownText(block: Block): string[] {
  const b = block as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ["caption", "xLabel", "yLabel", "endLabel", "rowLabel", "colLabel", "valueLabel", "prompt", "note", "bottomLabel", "topLabel", "label"]) {
    if (typeof b[k] === "string") out.push((b[k] as string).replace(/_{3,}/g, " "));
  }
  for (const k of ["tokens", "ticks"]) if (Array.isArray(b[k])) out.push(...(b[k] as string[]));
  if (Array.isArray(b.items)) out.push(...(b.items as Array<{ label: string }>).map((i) => i.label));
  if (Array.isArray(b.layers)) out.push(...(b.layers as Array<string | { label: string; dim?: string }>).flatMap((l) => (typeof l === "string" ? [l] : [l.label, l.dim ?? ""])));
  return out.filter(Boolean);
}

// Returns why a block shows something its beat never says, or null when it is grounded.
export function checkDeviceHonesty(block: Block, source: { narration: string; onscreen: string[]; sceneTitle?: string }): string | null {
  const text = [source.narration, ...source.onscreen, source.sceneTitle ?? ""].join(" ");
  const said = words(text);
  const saidNumbers = numbersIn(text);
  for (const shown of shownText(block)) {
    // "Stage 2" names a position in a sequence, not a quantity, so its number needs no source.
    const position = /^[A-Za-z]+ (\d{1,2})$/.exec(shown.trim());
    const counted = position && Number(position[1]) <= 12 ? shown.replace(/\d+/, "") : shown;
    for (const digits of counted.match(/\d+(?:\.\d+)?/g) ?? []) {
      const n = Number(digits);
      if (!text.includes(digits) && !saidNumbers.some((v) => Math.abs(v - n) < 1e-9)) {
        return `"${shown}" shows ${digits}, which the narration never says`;
      }
    }
    for (const w of words(shown)) {
      if (STOP.has(w) || CHART_WORDS.has(w) || w.length < 3) continue;
      if (!said.some((s) => sameStem(s, w))) return `"${shown}" uses "${w}", which the beat never says`;
    }
  }
  if (block.c === "Distribution") {
    const total = block.items.reduce((sum, i) => sum + i.p, 0);
    if (total > 1.01) return `shares add up to ${Math.round(total * 100)}%, more than the whole`;
  }
  if (block.c === "TokenStrip" && block.lit.some((i) => i >= block.tokens.length)) return "lights a token that is not in the strip";
  return null;
}

// Drops what a model sends for optional fields it has nothing for (nulls, an unknown sweep).
function tidy(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== null && v !== "") out[k] = v;
  if (out.sweep !== undefined && out.sweep !== "row" && out.sweep !== "cell") delete out.sweep;
  return out;
}

// Pulls the first JSON object out of a model reply.
function parseReply(raw: string): Record<string, Record<string, unknown>> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Authors and checks chart data for every request in one model call. Never throws: a failed call
// or reply leaves every request without a block, which keeps those beats on their text cards.
export async function authorDeviceData(requests: DeviceRequest[], caller: DeviceLlmCaller): Promise<AuthoredDevices> {
  const blocks = new Map<string, Block>();
  const refusals = new Map<string, string>();
  const wanted = requests.map((r) => ({ ...r, kinds: r.kinds.filter((k) => AUTHORED_DEVICES.includes(k)) })).filter((r) => r.kinds.length);
  if (!wanted.length) return { blocks, refusals };

  let reply: Record<string, Record<string, unknown>> | null = null;
  try {
    reply = parseReply(await caller(renderDevicePrompt(wanted), SYSTEM));
  } catch (err) {
    const reason = `chart data model failed: ${err instanceof Error ? err.message : String(err)}`;
    for (const r of wanted) for (const k of r.kinds) refusals.set(`${r.key}:${k}`, reason);
    return { blocks, refusals };
  }

  for (const r of wanted) {
    for (const kind of r.kinds) {
      const id = `${r.key}:${kind}`;
      const raw = reply?.[r.key]?.[kind];
      if (raw == null) {
        refusals.set(id, reply ? "the model found nothing in the narration to chart" : "the model reply was not JSON");
        continue;
      }
      const parsed = blockSchema.safeParse({ ...tidy(raw as Record<string, unknown>), c: kind });
      if (!parsed.success) {
        refusals.set(id, `not a valid ${kind}: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
        continue;
      }
      const dishonest = checkDeviceHonesty(parsed.data, r);
      if (dishonest) refusals.set(id, dishonest);
      else blocks.set(id, parsed.data);
    }
  }
  return { blocks, refusals };
}

// Uses Gemini to author chart data when it is configured, or nothing (beats keep their text cards).
export async function defaultDeviceCaller(): Promise<DeviceLlmCaller | null> {
  const { generateText, isGoogleAiConfigured } = await import("../modelClient");
  if (!isGoogleAiConfigured()) return null;
  return (prompt, systemInstruction) => generateText(prompt, { systemInstruction, temperature: 0.2 });
}
