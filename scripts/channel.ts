/**
 * File Description: Prints the derived checkout channel for the shell dispatcher.
 * Inputs and outputs: checkout path and optional field -> channel banner on stderr or requested field on stdout.
 * Used by: bin/aideos.
 */

import { releaseChannel } from "../backend/releaseChannel";

const info = releaseChannel(process.argv[2]);
const field = process.argv[3];
if (field === "port") process.stdout.write(String(info.port));
else if (field === "version") console.log(info.description);
else if (field === "which") console.log(`${info.label}: ${info.root}`);
else {
  const color = process.env.NO_COLOR !== undefined ? "" : info.channel === "stable" ? "\u001b[32m" : "\u001b[38;5;208m";
  console.error(`${color}${info.description}${color ? "\u001b[0m" : ""}`);
}
