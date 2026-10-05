/**
 * File Description: CLI configuration for Remotion rendering and bundling.
 * Inputs and outputs: configuration API -> sets video image format, output overwrite, and render concurrency.
 * Used by: Remotion CLI commands (npm run render, npm run render:reel, npm run studio).
 */

import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(2);
Config.setTimeoutInMilliseconds(180000);
