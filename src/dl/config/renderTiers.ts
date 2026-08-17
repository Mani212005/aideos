/*
File Description: Defines Fast Preview vs. Photoreal Production quality configurations and performance budgets for Aideos video rendering.
*/

export enum RenderTier {
  FAST_PREVIEW = 'FAST_PREVIEW',
  PHOTOREAL_PRODUCTION = 'PHOTOREAL_PRODUCTION',
}

export interface RenderQualityConfig {
  tier: RenderTier;
  shadowMapSize: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  ssaoEnabled: boolean;
  maxTextureResolution: number;
  frameTimeoutMs: number;
}

export const RENDER_TIER_CONFIGS: Record<RenderTier, RenderQualityConfig> = {
  [RenderTier.FAST_PREVIEW]: {
    tier: RenderTier.FAST_PREVIEW,
    shadowMapSize: 512,
    bloomEnabled: false,
    bloomStrength: 0.0,
    ssaoEnabled: false,
    maxTextureResolution: 1024,
    frameTimeoutMs: 3000,
  },
  [RenderTier.PHOTOREAL_PRODUCTION]: {
    tier: RenderTier.PHOTOREAL_PRODUCTION,
    shadowMapSize: 2048,
    bloomEnabled: true,
    bloomStrength: 1.8,
    ssaoEnabled: true,
    maxTextureResolution: 4096,
    frameTimeoutMs: 15000,
  },
};

// Returns the RenderQualityConfig object for a given render tier.
export function getRenderQualityConfig(tier: RenderTier = RenderTier.PHOTOREAL_PRODUCTION): RenderQualityConfig {
  return RENDER_TIER_CONFIGS[tier] || RENDER_TIER_CONFIGS[RenderTier.PHOTOREAL_PRODUCTION];
}
