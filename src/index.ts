/**
 * File Description: Remotion entry point registering the root video composition.
 * Inputs and outputs: RemotionRoot component -> registers root Remotion entry.
 * Used by: Remotion CLI and bundler (entry point).
 */

import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
