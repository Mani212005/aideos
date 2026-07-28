import { kvcacheEpisode } from "./episodes/kvcache";

/**
 * The single swap point for which episode the project renders.
 *
 * Both `script.ts` (timing) and `theme.ts` (colour) read from here. Because the
 * episode modules are pure data with no runtime imports, neither creates an
 * import cycle — which is what lets the theme be chosen by the episode rather
 * than hardcoded in the components.
 */
export const ACTIVE_EPISODE = kvcacheEpisode;
