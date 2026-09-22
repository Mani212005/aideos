/**
 * File Description: Tests for the vision-judge SVG repair loop.
 * Verifies validator plus judge repair retries, pass-through when Chrome is unavailable,
 * and the rule that nothing reaches disk until it passes, with no network or browser.
 */

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildVisionRepairPrompt,
  pngBase64FromPngFile,
  synthesizeSvgAssetWithVision,
} from "./visionJudge";

const GOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet"><g id="rat"><circle cx="0" cy="0" r="40" fill="#FFFFFF" stroke="#111827" /></g><g id="maze"><rect x="-120" y="-60" width="240" height="120" fill="none" stroke="#64748B" /></g></svg>`;
const BAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="10" /></svg>`;

test("VisionJudge: buildVisionRepairPrompt carries judge reasons and validator errors", () => {
  const prompt = buildVisionRepairPrompt(
    "Base prompt",
    BAD_SVG,
    ["Invariant V-4 Violation: wrong viewBox"],
    { score: 0.2, pass: false, reasons: ["Wrong animal: shows a cat"], source: "jev" },
    "A rat in a maze",
  );
  assert.ok(prompt.includes("PREVIOUS ATTEMPT REJECTED"));
  assert.ok(prompt.includes("Invariant V-4"));
  assert.ok(prompt.includes("Wrong animal"));
  assert.ok(prompt.includes("A rat in a maze"));
});

test("VisionJudge: pngBase64FromPngFile reads a PNG as base64", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-vision-b64-"));
  try {
    const pngPath = path.join(dir, "tiny.png");
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    fs.writeFileSync(pngPath, bytes);
    const b64 = pngBase64FromPngFile(pngPath);
    assert.ok(b64.startsWith("iVBORw0KGgo"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("VisionJudge: synthesizeSvgAssetWithVision writes on judge pass", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-vision-pass-"));
  try {
    const llm = async () => `\`\`\`svg\n${GOOD_SVG}\n\`\`\``;
    const res = await synthesizeSvgAssetWithVision(
      { slug: "probe", componentName: "RatMaze", visualDirection: "A rat in a maze", intent: "A rat in a maze" },
      llm,
      dir,
      {
        rasterize: async () => "ZmFrZS1wbmctZGF0YQ==",
        judge: async () => ({ score: 0.9, pass: true, reasons: [], source: "jev" as const }),
      },
    );
    assert.equal(res.success, true);
    assert.ok(res.filePath && fs.existsSync(res.filePath));
    assert.deepEqual(res.elementIds, ["rat", "maze"]);
    assert.equal(res.score, 0.9);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("VisionJudge: repair loop retries a judged fail with reasons fed back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-vision-retry-"));
  try {
    const prompts: string[] = [];
    let calls = 0;
    const llm = async (prompt: string) => {
      prompts.push(prompt);
      calls++;
      return `\`\`\`svg\n${GOOD_SVG}\n\`\`\``;
    };
    let judged = 0;
    const res = await synthesizeSvgAssetWithVision(
      { slug: "probe", componentName: "RatMaze", visualDirection: "A rat in a maze", maxAttempts: 3 },
      llm,
      dir,
      {
        rasterize: async () => "ZmFrZS1wbmctZGF0YQ==",
        judge: async () => {
          judged++;
          if (judged === 1) {
            return { score: 0.2, pass: false, reasons: ["Shows a cat, not a rat"], source: "jev" as const };
          }
          return { score: 0.85, pass: true, reasons: [], source: "jev" as const };
        },
      },
    );
    assert.equal(res.success, true);
    assert.equal(calls, 2);
    assert.equal(res.attempts.length, 1);
    assert.ok(res.attempts[0].errors[0].includes("cat"));
    assert.ok(prompts[1].includes("PREVIOUS ATTEMPT REJECTED"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("VisionJudge: validator failures retry with errors fed back and write nothing on total failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-vision-bad-"));
  try {
    const prompts: string[] = [];
    const llm = async (prompt: string) => {
      prompts.push(prompt);
      return `\`\`\`svg\n${BAD_SVG}\n\`\`\``;
    };
    const res = await synthesizeSvgAssetWithVision(
      { slug: "probe", componentName: "Bad", visualDirection: "A rat", maxAttempts: 2 },
      llm,
      dir,
      {
        rasterize: async () => "ZmFrZS1wbmctZGF0YQ==",
        judge: async () => ({ score: 0.9, pass: true, reasons: [], source: "jev" as const }),
      },
    );
    assert.equal(res.success, false);
    assert.equal(prompts.length, 2);
    assert.ok(prompts[1].includes("PREVIOUS ATTEMPT REJECTED"));
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("VisionJudge: passes through when Chrome stills are unavailable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-vision-nochrome-"));
  try {
    const llm = async () => `\`\`\`svg\n${GOOD_SVG}\n\`\`\``;
    let judged = 0;
    const res = await synthesizeSvgAssetWithVision(
      { slug: "probe", componentName: "RatMaze", visualDirection: "A rat in a maze" },
      llm,
      dir,
      {
        rasterize: async () => null,
        judge: async () => {
          judged++;
          return { score: 0.9, pass: true, reasons: [], source: "jev" as const };
        },
      },
    );
    assert.equal(res.success, true);
    assert.equal(judged, 0);
    assert.ok(res.filePath && fs.existsSync(res.filePath));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
