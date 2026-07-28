/**
 * Note: when using the Node APIs (see `scripts/frames.mjs`) this file does not
 * apply — options are passed to those APIs directly.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

// The film is DOM and SVG only — no WebGL — so the default renderer is correct
// and there is no GPU flag to set here.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
