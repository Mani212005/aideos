/**
 * File Description: Frozen stage engine, action and cel identity with approved reference source hashes.
 * Inputs and outputs: registry constants -> finite approved identities and resource fingerprints.
 * Used by: stage validation, compilation, Node resource integrity checks and scripts/freeze_stage_resources.ts.
 */
export const STAGE_RESOURCE_HASH = "f90d8ead0f1ed04822aa6a82278f00483f163dc046491867bc67f3bceb9e7987";
export const STAGE_RESOURCES = {
  "src/dl/characters/expand.ts": "777bd07b050d09c20f70b63fc03edf91e5131fecbdbf19d86ac0f56bf4cec37e",
  "src/dl/characters/rig.ts": "995e4d2c3bbde609f39153d8edf749b00bf4711e7cc5f9d791e2c62dc093a95f",
  "src/dl/scene/characters/geometry.ts": "1be9146b2172e5cd4e3c1c7dae163095801c0b19717d19f6b72c423365451f09",
  "src/dl/scene/characters/face.ts": "4757e97280f90414e74b397b286166e5b93369594c95a5aa278832bb553df9d8",
  "src/dl/scene/characters/build.ts": "0f5d625375cd4facbd261b99a256f498f10bb16f6fb65eb7f9806f5e447f0162",
  "src/dl/scene/characters/apply.ts": "e5e1581b64a83ad3925a75328b264ff39831ab4979ff14a5e2a410024598b4b9",
  "src/dl/scene/props/paperGlider.ts": "ff44b6a9ecbc6dcd395a87bc28b254b1d3bf65c8a2c713c64a4989d65e442528",
  "src/dl/performance/iona.ts": "78a3ea5666b2e4c6b393b0a541b60e8d9124683fd16c0989a07e58937295566c",
  "src/dl/performance/receive.ts": "38d469a7fd56d73d7d715ebcaa225669f21792a3c744b18307c9b58ad2292c72",
  "src/dl/performance/retarget.ts": "159b130080749b207e240c4d9f1df971e16260d35f974188625a62489b26f9aa"
} as const;
export const APPROVED_REFERENCES = {
  "test_fixtures/characters/iona-legacy/iona-art-v1.js": "e3ca9debc7df90774ac05a9d97939a2ed7b8fe5f0d5360c1184367ac374ac75c",
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
