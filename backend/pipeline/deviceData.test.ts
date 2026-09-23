/**
 * File Description: Tests for model-authored chart data: one batched request, schema and honesty
 * checks on every block, and a clean refusal (never a stand-in) when the model fails or invents.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { blockSchema } from "../../src/dl/schema";
import { authorDeviceData, checkDeviceHonesty, renderDevicePrompt, type DeviceRequest } from "./deviceData";

const STACK: DeviceRequest = {
  key: "beat-01",
  narration: "At the bottom of the stack sits the hardware, then the kernels, then the model itself.",
  onscreen: ["The stack"],
  kinds: ["LayerStack", "TokenStrip"],
};

test("DeviceData: authors every request in one call and keeps grounded blocks", async () => {
  let calls = 0;
  const result = await authorDeviceData([STACK], async (prompt) => {
    calls += 1;
    assert.match(prompt, /beat-01/);
    assert.match(prompt, /LayerStack/);
    return "Here you go:\n" + JSON.stringify({ "beat-01": { LayerStack: { layers: ["Hardware", "Kernels", "Model"] }, TokenStrip: null } });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.blocks.get("beat-01:LayerStack"), blockSchema.parse({ c: "LayerStack", layers: ["Hardware", "Kernels", "Model"] }));
  assert.equal(result.refusals.get("beat-01:TokenStrip"), "the model found nothing in the narration to chart");
});

test("DeviceData: refuses labels and numbers the beat never says", () => {
  const src = { narration: "Most of the traffic goes to the fast path, and a small share falls back.", onscreen: ["Traffic"] };
  const invented = blockSchema.parse({ c: "Distribution", items: [{ label: "Direct Path", p: 0.6 }, { label: "Fallback", p: 0.4 }] });
  assert.match(checkDeviceHonesty(invented, src) ?? "", /direct/);
  const numbered = blockSchema.parse({ c: "Distribution", items: [{ label: "Fast path 62%", p: 0.62 }, { label: "Falls back", p: 0.38 }] });
  assert.match(checkDeviceHonesty(numbered, src) ?? "", /62/);
  const grounded = blockSchema.parse({ c: "Distribution", items: [{ label: "Fast path", p: 0.8 }, { label: "Falls back", p: 0.2 }] });
  assert.equal(checkDeviceHonesty(grounded, src), null);
  const overfull = blockSchema.parse({ c: "Distribution", items: [{ label: "Fast path", p: 0.8 }, { label: "Falls back", p: 0.5 }] });
  assert.match(checkDeviceHonesty(overfull, src) ?? "", /more than the whole/);
});

test("DeviceData: numbers the narration says in words may be shown in digits", () => {
  const src = { narration: "Seventy billion parameters are read for every token.", onscreen: [] };
  const bar = blockSchema.parse({ c: "ScaleBar", ticks: ["1B", "70B"], value: 0.8, label: "Parameters" });
  assert.match(checkDeviceHonesty(bar, src) ?? "", /"1B" shows 1/);
  const ok = blockSchema.parse({ c: "ScaleBar", ticks: ["70B"].concat(["Token"]), value: 0.8, label: "Parameters" });
  assert.equal(checkDeviceHonesty(ok, src), null);
});

test("DeviceData: a failed call, a non-JSON reply or a malformed block leaves the beat on its text card", async () => {
  const thrown = await authorDeviceData([STACK], async () => {
    throw new Error("quota");
  });
  assert.equal(thrown.blocks.size, 0);
  assert.match(thrown.refusals.get("beat-01:LayerStack") ?? "", /quota/);

  const prose = await authorDeviceData([STACK], async () => "I cannot help with that.");
  assert.equal(prose.blocks.size, 0);
  assert.equal(prose.refusals.get("beat-01:LayerStack"), "the model reply was not JSON");

  const malformed = await authorDeviceData([STACK], async () => JSON.stringify({ "beat-01": { LayerStack: { layers: "Hardware" } } }));
  assert.equal(malformed.blocks.size, 0);
  assert.match(malformed.refusals.get("beat-01:LayerStack") ?? "", /not a valid LayerStack/);
});

test("DeviceData: StatCounter and Text are never sent to the model", async () => {
  let called = false;
  const result = await authorDeviceData([{ ...STACK, kinds: ["StatCounter", "Text"] }], async () => {
    called = true;
    return "{}";
  });
  assert.equal(called, false);
  assert.equal(result.blocks.size, 0);
  assert.doesNotMatch(renderDevicePrompt([STACK]), /StatCounter/);
});

test("DeviceData: position labels need no narrated number, and empty optional fields are dropped", async () => {
  const src = { narration: "The pipeline has four stages, from raw input to the final answer.", onscreen: [] };
  const stages = blockSchema.parse({ c: "LayerStack", layers: ["Stage 1", "Stage 2", "Stage 3", "Stage 4"] });
  assert.equal(checkDeviceHonesty(stages, src), null);
  const result = await authorDeviceData(
    [{ key: "b", ...src, kinds: ["MatrixGrid"] }],
    async () => JSON.stringify({ b: { MatrixGrid: { values: [[0.1, 0.9], [0.9, 0.1]], rowLabel: "Input", colLabel: null, sweep: "diagonal" } } }),
  );
  assert.equal(result.refusals.size, 0, [...result.refusals.values()].join("; "));
  assert.equal((result.blocks.get("b:MatrixGrid") as { sweep: string }).sweep, "row");
});
