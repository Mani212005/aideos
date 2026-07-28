/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(enableTailwind);

// The scene is WebGL. Headless Chrome defaults to SwiftShader, which is both slow
// and subtly different from the GPU path; ANGLE is the supported renderer for
// three.js content on macOS.
Config.setChromiumOpenGlRenderer("angle");
