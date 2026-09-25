/**
 * File Description: MCP tools for designing a film without a shell or a checkout.
 * A connected agent (local or reaching a hosted studio through `aideos connect`) reads the brief,
 * writes design.json and its SVG artwork, then builds and checks, all through these tools. Writes
 * are confined to a film's design spec and visuals folder, so an agent can never touch anything
 * else on the studio server; the build still refuses any design that fails the design check.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FILM_ID, VIDEOS_DIR } from "../pipeline/filmStore";
import { buildDesign, formatBuildStatus } from "../designSpec/build";
import { writeDesignBrief } from "../designSpec/brief";
import { checkFilmDesignById, formatDesignReport } from "../designCheck/designCheck";
import { frameReviewSchema, writeAgentReview } from "../visionJudge/agentReview";
import { judgeFramesDir } from "../visionJudge/sampler";

/** Files an agent may read inside a film package. */
const READABLE = /^(design\/(design|status|visual-choices|base-film)\.json|design\/BRIEF\.md|visuals\/[a-z0-9-]+\.svg|film\.json)$/;
/** Files an agent may write inside a film package. */
const WRITABLE = /^(design\/design\.json|visuals\/[a-z0-9-]+\.svg)$/;
/** Largest file an agent may write. */
const MAX_WRITE_BYTES = 300_000;

// Wraps text in the content shape MCP tool results use.
function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], ...(isError ? { isError: true } : {}) };
}

// Resolves a package-relative path after checking the film id and the path against a rule.
export function resolveFilmFile(filmId: string, rel: string, rule: RegExp): string {
  if (!FILM_ID.test(filmId)) throw new Error(`"${filmId}" is not a film id`);
  const clean = rel.replace(/^\.?\//, "");
  if (!rule.test(clean)) throw new Error(`"${rel}" is not a file this tool may touch (allowed: ${rule.source})`);
  const pkg = path.join(VIDEOS_DIR, filmId);
  if (!fs.existsSync(path.join(pkg, "film.json"))) throw new Error(`there is no film "${filmId}"`);
  return path.join(pkg, clean);
}

/** Registers the design tools on a server. */
export function registerDesignTools(server: McpServer): void {
  server.registerTool(
    "aideos_design_brief",
    {
      title: "Get a film's design brief",
      description:
        "Write and return the design brief for a film: what it says shot by shot, the standard layer every design must meet, the design.json format and a worked example. Start here.",
      inputSchema: { filmId: z.string().describe("Film id, e.g. speculative-decoding") },
    },
    async ({ filmId }) => {
      try {
        const file = writeDesignBrief(filmId);
        return text(fs.readFileSync(file, "utf8"));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    "aideos_read_file",
    {
      title: "Read a design file",
      description: "Read a file from a film package: film.json, design/design.json, design/status.json, design/visual-choices.json, design/BRIEF.md or visuals/<name>.svg.",
      inputSchema: { filmId: z.string(), path: z.string().describe("Path inside the film package, e.g. design/design.json") },
    },
    async ({ filmId, path: rel }) => {
      try {
        const file = resolveFilmFile(filmId, rel, READABLE);
        if (!fs.existsSync(file)) return text(`${rel} does not exist yet`, true);
        return text(fs.readFileSync(file, "utf8"));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    "aideos_write_file",
    {
      title: "Write a design file",
      description:
        "Write design/design.json or visuals/<name>.svg (lowercase, digits and dashes) in a film package. Nothing else can be written. Run aideos_design_build afterwards: only a passing build changes the film.",
      inputSchema: { filmId: z.string(), path: z.string(), content: z.string().max(MAX_WRITE_BYTES) },
    },
    async ({ filmId, path: rel, content }) => {
      try {
        const file = resolveFilmFile(filmId, rel, WRITABLE);
        if (rel.endsWith(".json")) JSON.parse(content);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return text(`wrote videos/${filmId}/${rel.replace(/^\.?\//, "")} (${Buffer.byteLength(content)} bytes)`);
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    "aideos_design_build",
    {
      title: "Build a film's design",
      description:
        "Compile design/design.json onto the film, run the design check, and write the film only when it passes. Returns PASS or every error to fix. The studio reloads the film on a pass.",
      inputSchema: { filmId: z.string() },
    },
    async ({ filmId }) => {
      if (!FILM_ID.test(filmId)) return text(`"${filmId}" is not a film id`, true);
      const status = buildDesign(filmId, "agent");
      return text(formatBuildStatus(filmId, status), status.state !== "passed");
    },
  );

  server.registerTool(
    "aideos_design_check",
    {
      title: "Check a film's design",
      description: "Run the design check on a film as it is now (schema, palette, type, continuity, timing, honest numbers) and return the findings.",
      inputSchema: { filmId: z.string() },
    },
    async ({ filmId }) => {
      if (!FILM_ID.test(filmId)) return text(`"${filmId}" is not a film id`, true);
      const report = checkFilmDesignById(filmId);
      return text(formatDesignReport(report), !report.ok);
    },
  );

  server.registerTool(
    "aideos_frame_stills",
    {
      title: "Get the sampled review stills",
      description:
        "Return the frames the vision judge sampled from a film (1920x1080 stills, rendered once) as images, each preceded by its frame number, shot, narration and on-screen copy. Critique each against its narration.",
      inputSchema: { filmId: z.string(), limit: z.number().int().min(1).max(12).default(6), offset: z.number().int().min(0).default(0) },
    },
    async ({ filmId, limit, offset }) => {
      try {
        resolveFilmFile(filmId, "film.json", /^film\.json$/);
        const manifestFile = path.join(VIDEOS_DIR, filmId, "design", "judge", "manifest.json");
        if (!fs.existsSync(manifestFile)) return text("no stills have been sampled for this film yet", true);
        const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as {
          samples: { frame: number; shotId: string; narration: string; onscreen: string[] }[];
        };
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
        for (const s of manifest.samples.slice(offset, offset + limit)) {
          const png = path.join(judgeFramesDir(filmId), `frame-${String(s.frame).padStart(6, "0")}.png`);
          if (!fs.existsSync(png)) continue;
          content.push({ type: "text", text: `frame ${s.frame} | shot ${s.shotId} | narration: ${s.narration} | on screen: ${s.onscreen.join(" / ")}` });
          content.push({ type: "image", data: fs.readFileSync(png).toString("base64"), mimeType: "image/png" });
        }
        content.push({ type: "text", text: `${manifest.samples.length} samples in all; this call returned ${offset}-${Math.min(manifest.samples.length, offset + limit) - 1}.` });
        return { content };
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    "aideos_submit_frame_review",
    {
      title: "Submit the frame review",
      description:
        "Submit your review of the sampled frames: per frame, your note (opinions), concrete suggestions, an image-text similarity score (0 to 1) against the narration for the frame as it is after any repair, and whether you repaired it. A text-only judge then rules on each frame and rates each suggestion.",
      inputSchema: { filmId: z.string(), samples: frameReviewSchema.shape.samples },
    },
    async ({ filmId, samples }) => {
      try {
        resolveFilmFile(filmId, "film.json", /^film\.json$/);
        const stored = writeAgentReview(filmId, { samples });
        return text(`stored a review of ${stored.samples.length} frames at ${stored.at}`);
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );
}
