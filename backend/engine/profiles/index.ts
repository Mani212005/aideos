/**
 * File Description: Loads pinned WanGP settings templates from backend/engine/profiles/.
 * Each profile is kilobytes of JSON committed to the repo; heavy model weights stay
 * on the GPU box (report section 3.2).
 */
import fs from "fs/promises";
import path from "path";

export interface EngineProfile {
  name: string;
  description: string;
  /** Canonical WanGP params; the engine overlays per-job fields on top. */
  params: Record<string, unknown>;
}

/** Read one profile by its tier name ("small" | "mid"). */
export async function loadProfile(name: "small" | "mid"): Promise<EngineProfile> {
  const file = path.join(__dirname, `${name}.json`);
  const raw = await fs.readFile(file, "utf-8");
  const parsed = JSON.parse(raw) as EngineProfile;
  if (!parsed || typeof parsed.params !== "object") {
    throw new Error(`profile "${name}" is malformed: missing params object`);
  }
  return parsed;
}
