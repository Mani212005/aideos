/**
 * Note: when using the Node APIs (see `scripts/frames.mjs`) this file does not
 * apply — options are passed to those APIs directly.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(2);
Config.setTimeoutInMilliseconds(180000);
