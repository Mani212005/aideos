/**
 * File Description: Frozen local art, rig, action and cel identity with approved reference source hashes.
 * Inputs and outputs: registry ids -> finite approved identities and resource fingerprints.
 * Used by: stage validation, compilation and Node resource integrity checks.
 */
export const STAGE_RESOURCE_HASH = "675cb9030633a2350ad9da0dbf18cb1055a06c81178ad02946b63e302dbb98c0";
export const STAGE_RESOURCES = {
  "src/dl/scene/rigs/iona-art-v1.js": "e3ca9debc7df90774ac05a9d97939a2ed7b8fe5f0d5360c1184367ac374ac75c",
  "src/dl/scene/rigs/iona.ts": "83efca52522666d88a72ffb51a1d11ba539b2ce22936b7df76950e625f8f0794",
  "src/dl/performance/iona.ts": "78a3ea5666b2e4c6b393b0a541b60e8d9124683fd16c0989a07e58937295566c",
  "src/dl/performance/receive.ts": "762aa9fbde96c7322f58671ab1cbc8a4c73252e660a62d252a3fb993e5568705"
} as const;
export const APPROVED_REFERENCES = {
  "test_fixtures/performance/iona/character.mjs": "cbc19b96336288d208cfb555f4f9b6803a4f74d8aaf1b2001d3a303ec0644005",
  "test_fixtures/performance/iona/performance.mjs": "cad8920bffe86c03dcc4256379c13977088b7781a9125552b31efbc3cf6a81ec",
  "test_fixtures/performance/iona/filmstrip.mjs": "11fda6e32bd72cd35a8e9f880f958e9cce61ed9806bb7471dc5a767319e5c1c7"
} as const;
export const CEL_TREATMENT = {
  id: "cel-v1", three: "0.180.0", dpr: 1, antialias: true,
  colorSpace: "srgb", toneMapping: "none", exposure: 1,
  outlineUnits: 0.04, ramp: [90, 175, 255], seed: 0,
  directionalIntensity: 2, ambientIntensity: Math.PI * 0.3,
} as const;
