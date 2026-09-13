/**
 * File Description: Unit tests for Generative SVG Synthesis Engine and Invariant Validation.
 * Covers the prompt contract, every invariant the gate enforces (framing, centring, determinism,
 * self-containment, well-formedness), the generate-validate-repair retry loop, and the rule that
 * nothing reaches a video package until it passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildSvgPrompt,
  buildSvgAssetPrompt,
  validateGeneratedSvg,
  validateGeneratedSvgAsset,
  cleanCodeFence,
  synthesizeBespokeSvg,
  synthesizeAnimatableSvgAsset,
} from "./generateSvg";
import { getVideosDir, getProjectRoot, listVideoPackages } from "../../src/dl/videoPackageLoader";

test("SVG Generator: buildSvgPrompt injects invariant rules and component name", () => {
  const prompt = buildSvgPrompt({
    slug: "what-is-jepa",
    componentName: "ToddlerPhysicsComparison",
    visualDirection: "Split screen: LLM text wall vs toddler physics understanding",
    topic: "JEPA World Models",
  });

  assert.ok(prompt.includes("ToddlerPhysicsComparison"));
  assert.ok(prompt.includes("Split screen: LLM text wall vs toddler physics understanding"));
  assert.ok(prompt.includes("Rule V-4"));
  assert.ok(prompt.includes("Rule V-2"));
  assert.ok(prompt.includes("preserveAspectRatio"));
});

test("SVG Generator: validateGeneratedSvg accepts conforming React SVG components", () => {
  const validComponent = `
import React from "react";
import { useAccent } from "../../../src/dl/accent";

export const ToddlerPhysicsComparison: React.FC<{ frame: number }> = ({ frame }) => {
  const accent = useAccent();
  return (
    <svg viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%" }}>
      <rect x="-280" y="-180" width="560" height="360" rx="12" fill="rgba(255,255,255,0.05)" stroke={accent} />
      <text x="0" y="0" textAnchor="middle" fill="#FFFFFF">Toddler Intuitive Physics</text>
    </svg>
  );
};
`;

  const result = validateGeneratedSvg(validComponent);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test("SVG Generator: validateGeneratedSvg accepts export function and JSX preserveAspectRatio syntax", () => {
  const functionExport = `
import React from "react";

export function CustomChart({ frame }: { frame: number }) {
  return (
    <svg viewBox="0 0 600 400" preserveAspectRatio={"xMidYMid meet"}>
      <circle cx="300" cy="200" r="50" />
    </svg>
  );
}
`;
  const res1 = validateGeneratedSvg(functionExport);
  assert.strictEqual(res1.valid, true);
  assert.strictEqual(res1.errors.length, 0);

  const defaultFunctionExport = `
import React from "react";

export default function AnimatedDiagram() {
  return (
    <svg viewBox="-300 -200 600 400" preserveAspectRatio={'xMidYMid meet'}>
      <rect x="-100" y="-100" width="200" height="200" />
    </svg>
  );
}
`;
  const res2 = validateGeneratedSvg(defaultFunctionExport);
  assert.strictEqual(res2.valid, true);
  assert.strictEqual(res2.errors.length, 0);
});

test("SVG Generator: validateGeneratedSvg rejects SVG violating Invariant V-4", () => {
  const missingViewBox = `
export const BadComponent: React.FC = () => {
  return (
    <svg preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="100" height="100" />
    </svg>
  );
};
`;
  const res1 = validateGeneratedSvg(missingViewBox);
  assert.strictEqual(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes("viewBox")));

  const missingAspect = `
export const BadAspectComponent: React.FC = () => {
  return (
    <svg viewBox="0 0 600 400">
      <rect x="0" y="0" width="100" height="100" />
    </svg>
  );
};
`;
  const res2 = validateGeneratedSvg(missingAspect);
  assert.strictEqual(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes("preserveAspectRatio")));
});

test("SVG Generator: cleanCodeFence strips markdown wrapping cleanly", () => {
  const markdownWrapped = "```tsx\nexport const MyComp = () => <svg />;\n```";
  const cleaned = cleanCodeFence(markdownWrapped);
  assert.strictEqual(cleaned, "export const MyComp = () => <svg />;");
});

test("SVG Generator: synthesizeBespokeSvg writes valid component to disk", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-svg-test-"));
  try {
    const mockLlm = async () => `\`\`\`tsx
import React from "react";
export const TestGeneratedSvg: React.FC = () => {
  return (
    <svg viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
      <circle cx="0" cy="0" r="50" fill="blue" />
    </svg>
  );
};
\`\`\``;

    const res = await synthesizeBespokeSvg(
      {
        slug: "test-video",
        componentName: "TestGeneratedSvg",
        visualDirection: "Blue circle glowing in center",
      },
      mockLlm,
      tempDir
    );

    assert.strictEqual(res.success, true);
    assert.ok(res.filePath && fs.existsSync(res.filePath));
    const content = fs.readFileSync(res.filePath, "utf8");
    assert.ok(content.includes("export const TestGeneratedSvg"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Video Package Loader: resolves project root and videos directory regardless of working directory", () => {
  const rootDir = getProjectRoot();
  assert.ok(fs.existsSync(rootDir));
  assert.ok(fs.existsSync(path.join(rootDir, "src", "dl")));

  const videosDir = getVideosDir();
  assert.ok(videosDir.endsWith(path.sep + "videos"));

  const packages = listVideoPackages();
  assert.ok(Array.isArray(packages));
});

test("SVG Generator: validateGeneratedSvg rejects malformed JSX that would break the bundle", () => {
  const unclosed = `
export const Broken: React.FC = () => (
  <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet">
    <g><rect x="280" y="180" width="40" height="40" />
  </svg>
);
`;
  const res = validateGeneratedSvg(unclosed);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("unclosed element")), res.errors.join(" | "));

  const mismatched = `
export const Broken2: React.FC = () => (
  <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet">
    <g><circle cx="300" cy="200" r="10" /></rect>
  </svg>
);
`;
  const res2 = validateGeneratedSvg(mismatched);
  assert.strictEqual(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes("is closed by")), res2.errors.join(" | "));
});

test("SVG Generator: validateGeneratedSvg rejects a viewBox outside the mandated framings", () => {
  const wrongBox = `
export const WrongFraming: React.FC = () => (
  <svg viewBox="0 0 1024 768" preserveAspectRatio="xMidYMid meet">
    <circle cx="512" cy="384" r="40" />
  </svg>
);
`;
  const res = validateGeneratedSvg(wrongBox);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("not one of the mandated framings")), res.errors.join(" | "));
});

test("SVG Generator: validateGeneratedSvg enforces Invariant V-2 centre containment", () => {
  const offCentre = `
export const OffCentre: React.FC = () => (
  <svg viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
    <rect x="-295" y="-195" width="30" height="30" />
    <circle cx="-280" cy="185" r="6" />
    <circle cx="285" cy="-185" r="6" />
  </svg>
);
`;
  const res = validateGeneratedSvg(offCentre);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("Invariant V-2")), res.errors.join(" | "));

  // A full-bleed backdrop is framing, not a subject, so it must not trip the rule on its own.
  const backdropPlusCentredSubject = `
export const Centred: React.FC = () => (
  <svg viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
    <rect x="-300" y="-200" width="600" height="400" fill="rgba(255,255,255,0.04)" />
    <circle cx="0" cy="0" r="60" />
  </svg>
);
`;
  assert.strictEqual(validateGeneratedSvg(backdropPlusCentredSubject).valid, true);
});

test("SVG Generator: validateGeneratedSvg enforces Invariant V-5 frame-driven purity", () => {
  const cases: Array<[string, string]> = [
    ["Math.random()", "<circle cx={Math.random() * 10} cy=\"0\" r=\"5\" />"],
    ["Date.now()", "<circle cx={Date.now() % 10} cy=\"0\" r=\"5\" />"],
    ["setTimeout()", "<circle cx={(() => { setTimeout(() => 1, 10); return 0; })()} cy=\"0\" r=\"5\" />"],
    ["SMIL <animate> element", "<circle cx=\"0\" cy=\"0\" r=\"5\"><animate attributeName=\"r\" dur=\"2s\" /></circle>"],
  ];

  for (const [label, body] of cases) {
    const code = `
export const Impure: React.FC<{ frame: number }> = () => (
  <svg viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
    ${body}
  </svg>
);
`;
    const res = validateGeneratedSvg(code);
    assert.strictEqual(res.valid, false, `${label} must be rejected`);
    assert.ok(
      res.errors.some((e) => e.includes("Invariant V-5") && e.includes(label)),
      `${label}: ${res.errors.join(" | ")}`,
    );
  }
});

test("SVG Generator: validateGeneratedSvg enforces Invariant V-6 self-containment", () => {
  const remote = `
import fs from "node:fs";
export const NotSelfContained: React.FC = () => (
  <svg viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
    <image href="https://example.com/logo.png" x="-40" y="-40" width="80" height="80" />
  </svg>
);
`;
  const res = validateGeneratedSvg(remote);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("Invariant V-6") && e.includes("node: import")), res.errors.join(" | "));
  assert.ok(res.errors.some((e) => e.includes("remote href")), res.errors.join(" | "));
});

test("SVG Generator: validateGeneratedSvg rejects a chat reply that is not a bare module", () => {
  const prose = `Sure! Here is the component you asked for:

export const WithPreamble: React.FC = () => (
  <svg viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
    <circle cx="0" cy="0" r="40" />
  </svg>
);
`;
  const res = validateGeneratedSvg(prose);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("not a bare module")), res.errors.join(" | "));
});

test("SVG Generator: synthesizeBespokeSvg retries with the errors fed back and never writes bad output", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-svg-retry-"));
  try {
    const prompts: string[] = [];
    let call = 0;
    const flakyLlm = async (prompt: string) => {
      prompts.push(prompt);
      call++;
      if (call === 1) {
        // Wrong framing and non-deterministic.
        return "```tsx\nexport const Flaky: React.FC = () => (\n  <svg viewBox=\"0 0 100 100\" preserveAspectRatio=\"xMidYMid meet\">\n    <circle cx={Math.random()} cy=\"50\" r=\"5\" />\n  </svg>\n);\n```";
      }
      return "```tsx\nexport const Flaky: React.FC<{ frame: number }> = ({ frame }) => (\n  <svg viewBox=\"-300 -200 600 400\" preserveAspectRatio=\"xMidYMid meet\">\n    <circle cx=\"0\" cy=\"0\" r={20 + frame * 0.1} />\n  </svg>\n);\n```";
    };

    const res = await synthesizeBespokeSvg(
      { slug: "retry-video", componentName: "Flaky", visualDirection: "A pulsing dot" },
      flakyLlm,
      tempDir,
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(prompts.length, 2, "A rejected attempt must be retried");
    assert.ok(prompts[1].includes("PREVIOUS ATTEMPT REJECTED"), "The retry must tell the model what failed");
    assert.ok(prompts[1].includes("Invariant V-5"), "The retry must carry the specific errors");
    assert.strictEqual(res.attempts.length, 1, "The rejected attempt must be reported");

    const written = fs.readFileSync(res.filePath!, "utf8");
    assert.ok(!written.includes("Math.random"), "Only the accepted output may be written");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("SVG Generator: synthesizeBespokeSvg fails loudly and writes nothing when every attempt is bad", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-svg-fail-"));
  try {
    let calls = 0;
    const alwaysBad = async () => {
      calls++;
      return "```tsx\nexport const Bad: React.FC = () => (<svg viewBox=\"0 0 9 9\"><circle cx=\"4\" cy=\"4\" r=\"1\" /></svg>);\n```";
    };

    const res = await synthesizeBespokeSvg(
      { slug: "bad-video", componentName: "Bad", visualDirection: "Nothing good", maxAttempts: 2 },
      alwaysBad,
      tempDir,
    );

    assert.strictEqual(res.success, false);
    assert.strictEqual(calls, 2, "maxAttempts must bound the retry loop");
    assert.strictEqual(res.attempts.length, 2);
    assert.ok(res.errors && res.errors.length > 0, "Failure must name what was wrong");
    assert.deepEqual(fs.readdirSync(tempDir), [], "A failed generation must leave the package untouched");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("SVG Generator: synthesizeBespokeSvg surfaces a model call failure as a reported attempt", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-svg-throw-"));
  try {
    const throwingLlm = async () => {
      throw new Error("upstream 503");
    };

    const res = await synthesizeBespokeSvg(
      { slug: "err-video", componentName: "Err", visualDirection: "Anything", maxAttempts: 2 },
      throwingLlm,
      tempDir,
    );

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.attempts.length, 2);
    assert.ok(res.attempts[0].errors[0].includes("upstream 503"));
    assert.deepEqual(fs.readdirSync(tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("SVG Asset Generator: buildSvgAssetPrompt demands addressable ids and a static document", () => {
  const prompt = buildSvgAssetPrompt({
    slug: "kvcache",
    componentName: "CacheDiagram",
    visualDirection: "Three cache tiers filling up",
  });
  assert.ok(prompt.includes("Rule V-7"));
  assert.ok(prompt.includes("CacheDiagram"));
  assert.ok(prompt.includes("Three cache tiers filling up"));
  assert.ok(prompt.includes("preserveAspectRatio"));
});

test("SVG Asset Generator: validateGeneratedSvgAsset gates framing, ids, staticness and self-containment", () => {
  const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
  <g id="tier-1"><rect x="-120" y="-60" width="80" height="60" fill="#FFFFFF" stroke="#111827" /></g>
  <g id="tier-2"><rect x="40" y="-60" width="80" height="60" fill="#FFFFFF" stroke="#111827" /></g>
</svg>`;
  assert.strictEqual(validateGeneratedSvgAsset(good).valid, true, JSON.stringify(validateGeneratedSvgAsset(good).errors));

  const noIds = good.replace(/ id="[^"]+"/g, "");
  const noIdsRes = validateGeneratedSvgAsset(noIds);
  assert.strictEqual(noIdsRes.valid, false);
  assert.ok(noIdsRes.errors.some((e) => e.includes("Invariant V-7")), noIdsRes.errors.join(" | "));

  const animated = good.replace("</svg>", '<animate attributeName="opacity" dur="2s" /></svg>');
  const animatedRes = validateGeneratedSvgAsset(animated);
  assert.strictEqual(animatedRes.valid, false);
  assert.ok(animatedRes.errors.some((e) => e.includes("Invariant V-5")), animatedRes.errors.join(" | "));

  const duplicateIds = good.replace('id="tier-2"', 'id="tier-1"');
  const dupRes = validateGeneratedSvgAsset(duplicateIds);
  assert.strictEqual(dupRes.valid, false);
  assert.ok(dupRes.errors.some((e) => e.includes("Duplicate element id")), dupRes.errors.join(" | "));

  const malformed = good.replace("</g>", "");
  const malformedRes = validateGeneratedSvgAsset(malformed);
  assert.strictEqual(malformedRes.valid, false);
  assert.ok(malformedRes.errors.some((e) => e.includes("SVG_PARSE_ERROR")), malformedRes.errors.join(" | "));

  const remote = good.replace(
    '<g id="tier-2">',
    '<g id="tier-2"><image href="https://example.com/a.png" x="-20" y="-20" width="40" height="40" />',
  );
  const remoteRes = validateGeneratedSvgAsset(remote);
  assert.strictEqual(remoteRes.valid, false);
  assert.ok(remoteRes.errors.some((e) => e.includes("Invariant V-6")), remoteRes.errors.join(" | "));

  const wrongBox = good.replace('viewBox="-300 -200 600 400"', 'viewBox="0 0 100 100"');
  const wrongBoxRes = validateGeneratedSvgAsset(wrongBox);
  assert.strictEqual(wrongBoxRes.valid, false);
  assert.ok(wrongBoxRes.errors.some((e) => e.includes("Invariant V-4")), wrongBoxRes.errors.join(" | "));
});

test("SVG Asset Generator: synthesizeAnimatableSvgAsset writes an .svg and reports its element ids", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-svg-asset-"));
  try {
    const llm = async () => `\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
  <g id="node-a"><circle cx="-80" cy="0" r="30" fill="#FFFFFF" stroke="#111827" /></g>
  <g id="node-b"><circle cx="80" cy="0" r="30" fill="#FFFFFF" stroke="#111827" /></g>
  <g id="edge-a-b"><path d="M-50 0 L50 0" fill="none" stroke="#64748B" /></g>
</svg>
\`\`\``;

    const res = await synthesizeAnimatableSvgAsset(
      { slug: "asset-video", componentName: "TwoNodeGraph", visualDirection: "Two nodes joined by an edge" },
      llm,
      tempDir,
    );

    assert.strictEqual(res.success, true);
    assert.ok(res.filePath!.endsWith("TwoNodeGraph.svg"));
    assert.deepEqual(res.elementIds, ["node-a", "node-b", "edge-a-b"]);
    assert.ok(fs.readFileSync(res.filePath!, "utf8").includes('id="edge-a-b"'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
