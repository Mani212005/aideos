import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildSvgPrompt,
  validateGeneratedSvg,
  cleanCodeFence,
  synthesizeBespokeSvg,
} from "./generateSvg";

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
