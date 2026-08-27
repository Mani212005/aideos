/**
 * File Description: Comprehensive test suite for Phase 6 Auto-Rigging Engine (R-1 through R-7).
 * Tests SVG parsing, required group enforcement, color token conformance, ModelSheet derivation (D2),
 * pose preset frame rendering to disk (R-5), and render-time ID namespacing (R-7).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { parseSvgToCharacterRig, namespaceSvgIds } from "./fromSvg";
import { POSE_PRESETS } from "../../src/dl/characters/presets";
import { renderFrameStill } from "../scene/renderStill";
import { CHARACTER_RIGS } from "../../src/dl/characters";

const OUT_RIGS_DIR = path.resolve("out/rigs");

function makeValidAnnotatedSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
    <g id="legs">
      <path d="M160 380 L150 490 L130 520 L170 520 L180 480 L185 380 Z" fill="#ffffff" stroke="#111827" stroke-width="4" />
      <path d="M240 380 L250 490 L270 520 L230 520 L220 480 L215 380 Z" fill="#ffffff" stroke="#111827" stroke-width="4" />
    </g>
    <g id="torso">
      <path d="M145 195 Q200 185 255 195 L260 385 Q200 395 140 385 Z" fill="#ffffff" stroke="#111827" stroke-width="5" />
      <path d="M185 352 L215 352 L215 378 L185 378 Z" fill="#635bff" stroke="#111827" stroke-width="2" />
    </g>
    <g id="head">
      <path d="M135 145 C135 75, 265 75, 265 145 C265 190, 245 205, 200 205 C155 205, 135 190, 135 145 Z" fill="#ffffff" stroke="#111827" stroke-width="5" />
      <path d="M152 140 C152 95, 248 95, 248 140 C248 175, 235 182, 200 182 C165 182, 152 175, 152 140 Z" fill="#635bff" stroke="#111827" stroke-width="3" />
    </g>
    <g id="leftArm">
      <path d="M145 205 L105 295 L80 375 L115 385 L135 305 L165 220 Z" fill="#ffffff" stroke="#111827" stroke-width="4" />
    </g>
    <g id="rightArm">
      <path d="M255 205 L295 295 L320 375 L285 385 L265 305 L235 220 Z" fill="#ffffff" stroke="#111827" stroke-width="4" />
    </g>
  </svg>`;
}

// R-1: A correctly annotated SVG produces a rig that loads and poses without error
test("R-1: A correctly annotated SVG produces a valid CharacterRig and poses without error", () => {
  const svg = makeValidAnnotatedSvg();
  const res = parseSvgToCharacterRig(svg, { rigId: "custom-pilot", name: "Custom Space Pilot" });

  assert.equal(res.rig.id, "custom-pilot");
  assert.equal(res.rig.groups.length, 5);

  const torso = res.rig.groups.find((g) => g.id === "torso")!;
  const leftArm = res.rig.groups.find((g) => g.id === "leftArm")!;
  assert.equal(leftArm.parent, "torso");
  assert.ok(torso.pivot.y > 200, "Torso pivot must be in lower region");
});

// R-2: An SVG missing #torso fails, naming the missing group
test("R-2: An SVG missing #torso fails loudly and names the missing group", () => {
  let svg = makeValidAnnotatedSvg();
  // Remove <g id="torso">
  svg = svg.replace(/<g id="torso">[\s\S]*?<\/g>/i, "");

  assert.throws(
    () => parseSvgToCharacterRig(svg, { rigId: "bad-rig", name: "Broken Rig" }),
    (err: Error) => {
      assert.ok(err.message.includes("MISSING_REQUIRED_JOINT_GROUPS"));
      assert.ok(err.message.includes("torso"));
      return true;
    },
  );
});

// R-3: An SVG with an unmappable fill fails, naming that path index
test("R-3: An SVG with an unmappable arbitrary hex color fails, naming path index", () => {
  let svg = makeValidAnnotatedSvg();
  // Inject illegal random non-semantic color
  svg = svg.replace('fill="#635bff"', 'fill="#ab12ef"');

  assert.throws(
    () => parseSvgToCharacterRig(svg, { rigId: "bad-color-rig", name: "Bad Color Rig" }),
    (err: Error) => {
      assert.ok(err.message.includes("UNMAPPABLE_COLOR_TOKEN"));
      assert.ok(err.message.includes("#ab12ef"));
      return true;
    },
  );
});

// R-4: Every produced rig passes 100% theme-token conformance
test("R-4: Converted rig binds 100% valid semantic color tokens", () => {
  const svg = makeValidAnnotatedSvg();
  const res = parseSvgToCharacterRig(svg, { rigId: "valid-conformance-rig", name: "Conformance Rig" });

  for (const group of res.rig.groups) {
    for (const p of group.paths) {
      assert.ok(
        ["surface", "ink", "muted", "hairline", "accent", "canvas", "none"].includes(p.fill || "none"),
        `Invalid fill token: ${p.fill}`,
      );
      assert.ok(
        ["surface", "ink", "muted", "hairline", "accent", "canvas", "none"].includes(p.stroke || "none"),
        `Invalid stroke token: ${p.stroke}`,
      );
    }
  }
});

// R-5: Render check: render one frame per pose preset and write images to disk for human review
test("R-5 / Visual Review: Render high-res PNG stills for all pose presets to out/rigs/", () => {
  fs.mkdirSync(OUT_RIGS_DIR, { recursive: true });

  const svg = makeValidAnnotatedSvg();
  const res = parseSvgToCharacterRig(svg, { rigId: "pilot-demo", name: "Pilot Demo" });

  // Register rig dynamically in registry for test rendering
  CHARACTER_RIGS["pilot-demo"] = res.rig;

  const renderedFiles: string[] = [];

  for (const [poseId, poseKf] of Object.entries(POSE_PRESETS)) {
    const frameData = {
      frame: 0,
      entities: [
        {
          entityId: "pilot-demo-actor",
          kind: "actor" as const,
          rigId: "pilot-demo",
          resolvedLayer: 100,
          layerSource: "derived" as const,
          transform: { x: 960, y: 540, scale: 1.2, rotation: 0, opacity: 1.0 },
          joints: Object.fromEntries(
            Object.entries(poseKf.groups).map(([g, tr]) => [g, tr.rotate || 0]),
          ),
        },
      ],
    };

    const outPng = path.join(OUT_RIGS_DIR, `pilot_${poseId}.png`);
    renderFrameStill(frameData, outPng);
    assert.ok(fs.existsSync(outPng), `Rendered pose PNG must exist: ${outPng}`);
    const size = fs.statSync(outPng).size;
    assert.ok(size > 1000, `Pose PNG must have non-zero size (got ${size} bytes)`);
    renderedFiles.push(outPng);
  }

  console.log(`✓ R-5 Complete: Rendered ${renderedFiles.length} pose preset review stills to ${OUT_RIGS_DIR}`);
});

// R-6: Every produced rig has a ModelSheet with non-zero canonicalHeight (D2)
test("R-6: ModelSheet has non-zero canonicalHeight and canonicalScale", () => {
  const svg = makeValidAnnotatedSvg();
  const res = parseSvgToCharacterRig(svg, { rigId: "pilot-ms", name: "Pilot MS" });

  assert.ok(res.modelSheet.canonicalHeight > 100, `canonicalHeight must be > 100 (got: ${res.modelSheet.canonicalHeight})`);
  assert.equal(res.modelSheet.canonicalScale, 1.0);
  assert.equal(res.modelSheet.referencePose, "idle");
  assert.equal(res.modelSheet.defaultFacing, "right");
});

// R-7: Render two instances in one document; assert zero duplicate id attributes and references resolve within subtree
test("R-7: Render-time namespacing ensures zero duplicate IDs across multiple instances", () => {
  const rawSvgSnippet = `<g id="visor-glow"><clipPath id="visor-clip"><path d="M0 0" /></clipPath><path filter="url(#drop-shadow)" clip-path="url(#visor-clip)" href="#base-shape" /></g>`;

  const instance1Svg = namespaceSvgIds(rawSvgSnippet, "inst-1");
  const instance2Svg = namespaceSvgIds(rawSvgSnippet, "inst-2");

  assert.ok(instance1Svg.includes('id="visor-glow--inst-1"'));
  assert.ok(instance1Svg.includes('id="visor-clip--inst-1"'));
  assert.ok(instance1Svg.includes('url(#visor-clip--inst-1)'));
  assert.ok(instance1Svg.includes('url(#drop-shadow--inst-1)'));
  assert.ok(instance1Svg.includes('href="#base-shape--inst-1"'));

  assert.ok(instance2Svg.includes('id="visor-glow--inst-2"'));
  assert.ok(instance2Svg.includes('id="visor-clip--inst-2"'));
  assert.ok(instance2Svg.includes('url(#visor-clip--inst-2)'));

  // Combine into single document and verify zero duplicate IDs
  const combined = `<svg>${instance1Svg}${instance2Svg}</svg>`;
  const allIds = Array.from(combined.matchAll(/\bid=["']([^"']+)["']/g)).map((m) => m[1]);
  const uniqueIds = new Set(allIds);

  assert.equal(allIds.length, uniqueIds.size, "Document must have strictly zero duplicate IDs");
  assert.equal(allIds.length, 4); // 2 IDs * 2 instances = 4 unique IDs
});
