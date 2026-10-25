/**
 * File Description: Delivers reel cuts inline, to a connected agent, or through the generation model with checked retries.
 * Inputs and outputs: package slug and delivery policy -> passing reel film or actionable needs_reel_cut stop.
 * Used by: production reel stage and aideos reel build.
 */
import fs from "node:fs";
import path from "node:path";
import { generationCaller } from "../aideosConfig";
import { dispatchTask } from "../agentBridge/dispatcher";
import type { DesignLlmCaller } from "../designSpec/designer";
import type { LineSynthesizer } from "../endCard/voice";
import { parseFilm, type Film } from "../../src/dl/schema";
import { deliveryTimeline, DELIVERY_CONFIG } from "../../src/dl/delivery";
import { buildReel } from "./build";
import { reelPackageDir, writeReelBrief } from "./brief";
import { reelBudgetFor } from "./store";
import { reelCutSchema } from "./schema";
import { ProductionError } from "../pipeline/types";

export type ReelDeliveryMode = "inline" | "agent" | "server";
export interface ReelWriterOptions {
  mode?: ReelDeliveryMode;
  llmCaller?: DesignLlmCaller | null;
  synthesize?: LineSynthesizer;
  skipAgent?: boolean;
  ownerKey?: string;
  agentTimeoutMs?: number;
  pollMs?: number;
  onProgress?: (message: string) => void;
}
export type ReelOutcome = { status: "passed"; film: Film } | { status: "needs_reel_cut"; note: string; nextSteps: string[] };

// Validates model JSON and stamps its provenance without granting owner approval.
function modelCut(reply: string): unknown {
  const body = reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const cut = reelCutSchema.parse(JSON.parse(body));
  delete cut.approved;
  return { ...cut, source: "server-model" };
}

// Builds an existing or identity reel, then asks the selected writer to repair exact check, cap or design failures.
export async function deliverReel(slug: string, opts: ReelWriterOptions = {}): Promise<ReelOutcome> {
  const pkg = reelPackageDir(slug), cutFile = path.join(pkg, "reel/cut.json");
  const long = parseFilm(JSON.parse(fs.readFileSync(path.join(pkg, "film.json"), "utf8")));
  if (deliveryTimeline(long, "reel").totalFrames / long.fps <= DELIVERY_CONFIG.reel.maxSec) {
    return { status: "passed", film: await buildReel(slug, opts) };
  }
  const briefFile = writeReelBrief(slug, reelBudgetFor(long));
  let failure = "a separate condensed narration cut is required";
  if (fs.existsSync(cutFile)) {
    try { return { status: "passed", film: await buildReel(slug, opts) }; }
    catch (error) { failure = error instanceof Error ? error.message : String(error); }
  }
  const mode = opts.mode ?? "inline";
  if (mode === "server") {
    const caller = opts.llmCaller === undefined ? await generationCaller() : opts.llmCaller;
    if (!caller) throw new ProductionError("reel", "server reel writer is disabled");
    const system = fs.readFileSync(briefFile, "utf8") + "\nReturn only the complete reel/cut.json object. Never record captain approval.";
    let previous = fs.existsSync(cutFile) ? fs.readFileSync(cutFile, "utf8") : "No cut yet.";
    for (let attempt = 1; attempt <= 3; attempt++) {
      opts.onProgress?.(`server model reel attempt ${attempt}/3`);
      try {
        const raw = modelCut(await caller(`Write or repair this reel cut.\nPrevious cut:\n${previous}\nFailures to fix:\n${failure}`, system));
        previous = JSON.stringify(raw, null, 2);
        fs.writeFileSync(cutFile, previous + "\n");
        return { status: "passed", film: await buildReel(slug, opts) };
      } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    }
    throw new ProductionError("reel", `server reel writer exhausted three attempts:\n${failure}`);
  }
  if (mode === "agent") {
    if (opts.skipAgent || process.env.NODE_TEST_CONTEXT) throw new ProductionError("reel", "agent reel delivery is disabled");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const requestedAt = Date.now();
      const dispatch = await dispatchTask({ eventType: "reel_cut", filmId: slug, filmTitle: long.title, enableFallback: false,
        ...(opts.ownerKey ? { ownerKey: opts.ownerKey } : {}),
        customInstruction: `Read ${briefFile}. Write only reel/cut.json, then run aideos reel check ${slug}. Keep voice, speed, picture and caption placement. Do not record captain approval. Attempt ${attempt}/3.\nFix these failures:\n${failure}`,
      });
      if (!dispatch.channels.some((c) => ["agent_link", "tmux", "firstmate_inbox"].includes(c))) throw new ProductionError("reel", "agent reel mode requires a connected coding agent");
      opts.onProgress?.(`reel task delivered (${dispatch.channels.join(", ")}); waiting for cut.json`);
      const deadline = Date.now() + (opts.agentTimeoutMs ?? 20 * 60 * 1000);
      let received = false;
      while (Date.now() < deadline) {
        if (fs.existsSync(cutFile) && fs.statSync(cutFile).mtimeMs >= requestedAt) {
          try { JSON.parse(fs.readFileSync(cutFile, "utf8")); received = true; break; }
          catch { /* A write still in progress is not an agent's finished answer. */ }
        }
        await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 5000));
      }
      if (!received) throw new ProductionError("reel", "connected agent did not deliver a reel cut before the deadline");
      try { return { status: "passed", film: await buildReel(slug, opts) }; }
      catch (error) { failure = error instanceof Error ? error.message : String(error); }
    }
    throw new ProductionError("reel", `agent reel writer exhausted three attempts:\n${failure}`);
  }
  return { status: "needs_reel_cut", note: failure, nextSteps: [
    `Read ${briefFile}`, `Write ${cutFile}`, `Run aideos reel check ${slug}`, "Re-run the same command to narrate, build and render the reel.",
  ] };
}
