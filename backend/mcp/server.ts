/**
 * File Description: MCP server exposing the Aideos production pipeline as agent-callable tools.
 *
 * A full render takes tens of minutes, which no request/response protocol should be asked to hold
 * open, so aideos_produce_film starts a run in the background and returns a run id immediately.
 * The caller polls aideos_run_status for stage-by-stage progress and collects the finished file
 * paths when the run reports "done". Nothing here blocks the protocol on a long render.
 */

import fs from "fs";
import path from "path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runProduction } from "../pipeline/run";
import { FILM_ID, readFilm, writeFilm, ROOT, VIDEOS_DIR } from "../pipeline/filmStore";
import { PRODUCTION_STAGES, type ProductionProgress, type ProductionRequest, type ProductionResult } from "../pipeline/types";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../src/dl/convertFilm";
import { buildEditContext } from "../editContext/buildEditContext";
import { detectFillers } from "../editContext/detectFillers";
import { detectSilences } from "../editContext/detectSilences";
import { planEdits, applyEditProgram } from "../editPlanner";
import type { TranscribedWord } from "../transcribe";
import { taskQueue, traceBus } from "../agentBridge";
import { registerDesignTools } from "./designTools";

/** Everything known about one background production run. */
interface RunRecord {
  runId: string;
  slug: string;
  title: string;
  state: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  /** Progress events, newest last, capped so a long render cannot grow without bound. */
  events: ProductionProgress[];
  result?: ProductionResult;
  error?: string;
}

/** In-memory registry of runs this server process has started. */
const runs = new Map<string, RunRecord>();

/** How many progress events one run keeps; older ones are dropped as the render advances. */
const MAX_EVENTS = 400;

/** Mints a short, sortable run id. */
function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Starts a production run in the background and returns its record straight away. */
function startRun(request: ProductionRequest): RunRecord {
  const record: RunRecord = {
    runId: newRunId(),
    slug: request.slug ?? "",
    title: request.title ?? "Untitled Aideos Film",
    state: "running",
    startedAt: new Date().toISOString(),
    events: [],
  };
  runs.set(record.runId, record);

  void runProduction(request, (event) => {
    record.events.push(event);
    if (record.events.length > MAX_EVENTS) record.events.splice(0, record.events.length - MAX_EVENTS);
  })
    .then((result) => {
      record.state = "done";
      record.result = result;
      record.slug = result.slug;
      record.title = result.title;
      record.finishedAt = new Date().toISOString();
    })
    .catch((err: unknown) => {
      record.state = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      record.finishedAt = new Date().toISOString();
    });

  return record;
}

/** Formats a run record as the JSON payload a polling caller reads. */
function describeRun(record: RunRecord, eventLimit: number) {
  const events = record.events.slice(-eventLimit);
  const latest = record.events[record.events.length - 1];
  return {
    runId: record.runId,
    state: record.state,
    slug: record.slug,
    title: record.title,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    currentStage: latest?.stage,
    stageProgress: latest?.progress,
    lastMessage: latest?.message,
    events: events.map((e) => ({
      stage: e.stage,
      status: e.status,
      message: e.message,
      progress: e.progress,
      elapsedMs: e.elapsedMs,
    })),
    ...(record.error ? { error: record.error } : {}),
    ...(record.result
      ? {
          result: {
            slug: record.result.slug,
            durationSec: record.result.durationSec,
            shotCount: record.result.shotCount,
            ttsBackend: record.result.ttsBackend,
            filmPath: record.result.filmPath,
            voiceoverPath: record.result.voiceoverPath,
            captionsPath: record.result.captionsPath,
            brollClips: record.result.brollClips.map((c) => ({
              shotId: c.shotId,
              path: c.path,
              durationSec: c.durationSec,
            })),
            outputs: record.result.outputs,
            warnings: record.result.warnings,
            stoppedAfter: record.result.stoppedAfter,
          },
        }
      : {}),
  };
}

/** The few task fields an agent needs back after claiming or completing (the full context is large). */
function taskSummary(task: { id: string; status: string; eventType: string; filmId: string; claimedAt?: string; completedAt?: string } | null | undefined) {
  if (!task) return task;
  return { id: task.id, status: task.status, eventType: task.eventType, filmId: task.filmId, claimedAt: task.claimedAt, completedAt: task.completedAt };
}

/** Wraps a JSON payload in the content shape MCP tool results use. */
function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

/** Options for building the server. */
export interface McpServerOptions {
  /**
   * The toolset served over HTTP to an agent connected through `aideos connect`: it leaves out the
   * production-run tools (a full render is the studio owner's call, not a remote agent's) and
   * keeps film reading, editing, design and task tools.
   */
  remote?: boolean;
  /**
   * The agent's link to the studio when it works from its own session (added by the HTTP handler
   * for a paired token): lets it wait for the next studio task and report how a task ended.
   */
  link?: {
    waitForTask(holdMs: number): Promise<{ id: string; eventType: string; filmId: string; prompt: string } | null | "ended">;
    complete(taskId: string, summary: string | undefined, ok: boolean): void;
  };
}

/** Instructions a remote agent reads: it has no shell, only these tools. */
const REMOTE_INSTRUCTIONS =
  "You are connected to an Aideos studio through `aideos connect`. You have no shell and no checkout of the studio: " +
  "work only through these tools. To design a film: aideos_design_brief, then aideos_write_file for design/design.json " +
  "and visuals/<name>.svg, then aideos_design_build until it prints PASS, and aideos_design_check to review. " +
  "Report progress with aideos_report_step and finish the task you were given with aideos_complete_task. " +
  "If aideos_wait_for_task is available, call it repeatedly to receive the studio's tasks.";

/** Builds the server and registers every tool on it. */
export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const remote = options.remote === true;
  const server = new McpServer(
    { name: "aideos", version: "1.0.0" },
    {
      instructions: remote ? REMOTE_INSTRUCTIONS :
        "Aideos turns a narration script into a finished explainer film in two aspect ratios. " +
        "Call aideos_produce_film with a script to start a run; it returns a runId immediately " +
        "because a full render takes tens of minutes. Poll aideos_run_status with that runId " +
        "until its state is 'done' or 'failed', then read the output paths from the result. " +
        "Runs are resumable: calling aideos_produce_film again with the same slug reuses every " +
        "stage whose inputs have not changed.",
    },
  );

  // Production runs are left out of the remote toolset (see McpServerOptions.remote).
  if (!remote) {
  server.registerTool(
    "aideos_produce_film",
    {
      title: "Produce an Aideos film",
      description:
        "Start a background production run: synthesize narration from the script, compile the film " +
        "design, optionally render GPU b-roll, render the requested formats, and verify the output. " +
        "Returns a runId right away; poll aideos_run_status to follow it.",
      inputSchema: {
        script: z
          .string()
          .min(1)
          .describe(
            "The narration script. A Claude screenplay using '## timestamp - Title' headers with " +
              "[VISUAL], [NARRATION] and [ON SCREEN] beats gives the design stage on-screen copy and " +
              "visual direction to work from. Plain prose is narrated but produces bare canvas shots.",
          ),
        title: z.string().optional().describe("Film title. Defaults to the script's top-level heading."),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .optional()
          .describe("Package slug under videos/. Derived from the title when omitted. Reuse it to resume a run."),
        formats: z
          .array(z.enum(["long", "reel"]))
          .optional()
          .describe("Which deliverables to render: long is 1920x1080, reel is 1080x1920. Defaults to both."),
        broll: z
          .boolean()
          .optional()
          .describe("Generate b-roll footage on the GPU engine and wire it into the film. Adds roughly ten minutes per clip."),
        brollMaxClips: z.number().int().min(0).max(12).optional().describe("Cap on generated b-roll clips. Defaults to 4."),
        brollSeconds: z.number().min(3).max(12).optional().describe("Length of each b-roll clip in seconds. Defaults to 8."),
        ttsBackend: z
          .enum(["kokoro", "google", "say", "tone"])
          .optional()
          .describe("Pin the speech synthesizer. Defaults to Kokoro running locally with no API key."),
        voice: z.string().optional().describe("Voice id for the chosen synthesizer, for example af_heart."),
        speed: z.number().min(0.5).max(2).optional().describe("Narration pace multiplier. Below 1 slows delivery, which reads better for explainer copy. Defaults to 1."),
        music: z.string().optional().describe("Background music filename inside public/. Ducked under narration automatically."),
        outDir: z.string().optional().describe("Directory the finished mp4s land in. Defaults to the repo's out/."),
        resume: z.boolean().optional().describe("Reuse completed stages from a previous run of the same slug. Defaults to true."),
        force: z.array(z.enum(PRODUCTION_STAGES)).optional().describe("Stages to re-run even when resuming."),
        stopAfter: z.enum(PRODUCTION_STAGES).optional().describe("Stop cleanly after this stage instead of rendering."),
      },
    },
    async (input) => {
      const record = startRun(input as ProductionRequest);
      return jsonResult({
        runId: record.runId,
        state: record.state,
        message: "Production started. Poll aideos_run_status with this runId for progress.",
      });
    },
  );

  server.registerTool(
    "aideos_run_status",
    {
      title: "Check a production run",
      description:
        "Read the current stage, progress and messages of a run started by aideos_produce_film. " +
        "When state is 'done' the result carries the rendered file paths; when it is 'failed' the " +
        "error names the stage that failed and why.",
      inputSchema: {
        runId: z.string().describe("The runId returned by aideos_produce_film."),
        eventLimit: z.number().int().min(1).max(200).optional().describe("How many recent progress events to include. Defaults to 20."),
      },
    },
    async ({ runId, eventLimit }) => {
      const record = runs.get(runId);
      if (!record) {
        return jsonResult({ error: `no run named "${runId}" in this server process`, knownRuns: [...runs.keys()] });
      }
      return jsonResult(describeRun(record, eventLimit ?? 20));
    },
  );

  server.registerTool(
    "aideos_list_runs",
    {
      title: "List production runs",
      description: "List every run this server process has started, newest first.",
      inputSchema: {},
    },
    async () =>
      jsonResult(
        [...runs.values()]
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .map((r) => ({ runId: r.runId, slug: r.slug, title: r.title, state: r.state, startedAt: r.startedAt })),
      ),
  );
  }

  server.registerTool(
    "aideos_list_films",
    {
      title: "List video packages",
      description: "List the video packages on disk under videos/, with their title, shot count and duration.",
      inputSchema: {},
    },
    async () => {
      if (!fs.existsSync(VIDEOS_DIR)) return jsonResult([]);
      const packages = fs
        .readdirSync(VIDEOS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => {
          // Some packages predate the lowercase-dash id rule; list them rather than
          // failing the whole call on the first one whose directory name is not a slug.
          const film = FILM_ID.test(entry.name) ? readFilm(entry.name) : null;
          if (!film) return { slug: entry.name, valid: false };
          return {
            slug: entry.name,
            valid: true,
            title: film.title,
            shots: film.shots.length,
            durationSec: Number(film.shots.reduce((sum, s) => sum + s.dur, 0).toFixed(2)),
            hasVoiceover: fs.existsSync(path.join(VIDEOS_DIR, entry.name, "voiceover.wav")),
            brollShots: film.shots.filter((s) => s.blocks.some((b) => b.c === "AnalogyInset" && Boolean(b.src))).length,
          };
        });
      return jsonResult(packages);
    },
  );

  server.registerTool(
    "aideos_get_film",
    {
      title: "Read a film manifest",
      description: "Return the validated film manifest for a package: chapters, canvas nodes, and every shot with its narration.",
      inputSchema: {
        slug: z.string().regex(/^[a-z0-9-]+$/).describe("The package slug under videos/."),
      },
    },
    async ({ slug }) => {
      const film = FILM_ID.test(slug) ? readFilm(slug) : null;
      if (!film) return jsonResult({ error: `no film found for "${slug}"`, videosDir: path.relative(ROOT, VIDEOS_DIR) });
      return jsonResult(film);
    },
  );

  server.registerTool(
    "aideos_edit_film",
    {
      title: "Edit an Aideos film",
      description:
        "Edit an Aideos film using natural language instructions. Plans and executes editing operations " +
        "(text overlays, filler removal, dead air trimming, range trimming, volume/mute/hide, accent/theme) " +
        "with atomic rollback guarantees and saves the updated film.",
      inputSchema: {
        slug: z.string().regex(/^[a-z0-9-]+$/).describe("The package slug under videos/."),
        request: z.string().min(1).describe("Natural language edit request (e.g. 'remove filler words and add a title card')."),
        hints: z.string().optional().describe("Optional context, project knowledge, or instruction hints from the coding agent."),
        dryRun: z.boolean().optional().describe("When true, only plans the edits without writing changes to disk. Defaults to false."),
      },
    },
    async ({ slug, request, hints, dryRun }) => {
      const film = FILM_ID.test(slug) ? readFilm(slug) : null;
      if (!film) {
        return jsonResult({ error: `no film found for "${slug}"`, videosDir: path.relative(ROOT, VIDEOS_DIR) });
      }

      const layered = convertFilmToLayeredFilm(film);

      // Load transcript if available
      let transcript: TranscribedWord[] = [];
      const importWordsPath = path.join(VIDEOS_DIR, slug, "import_words.json");
      const voWordsPath = path.join(VIDEOS_DIR, slug, "voiceover_words.json");
      if (fs.existsSync(importWordsPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(importWordsPath, "utf8"));
          transcript = raw.words || [];
        } catch {}
      } else if (fs.existsSync(voWordsPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(voWordsPath, "utf8"));
          transcript = raw.words || [];
        } catch {}
      }

      const fillers = detectFillers(transcript);
      const silences = detectSilences(transcript);
      const clipsDuration = layered.clips.reduce(
        (max: number, c: any) => Math.max(max, c.position + (c.end - c.start)),
        0,
      );
      const shotsDuration = film.shots.reduce((acc, s) => acc + (s.dur || 3), 0);
      const durationSec = clipsDuration > 0 ? clipsDuration : shotsDuration > 0 ? shotsDuration : 30;

      const context = buildEditContext(layered, transcript, fillers, silences, {
        fps: film.fps,
        durationSec,
        accent: film.accent,
        theme: film.theme,
      });

      const planResult = await planEdits(request, context, undefined, { agentHints: hints });

      if (dryRun) {
        return jsonResult({
          slug,
          applied: false,
          dryRun: true,
          plan: planResult.plan,
          ops: planResult.ops,
          attempts: planResult.attempts,
          warnings: planResult.warnings,
        });
      }

      const appliedResult = applyEditProgram(layered, planResult.ops, context);
      if (appliedResult.rejected.length > 0) {
        return jsonResult({
          slug,
          applied: false,
          error: "Failed to apply planned operations",
          rejected: appliedResult.rejected,
          plan: planResult.plan,
          ops: planResult.ops,
        });
      }

      const updatedFilm = convertLayeredFilmToFilm(appliedResult.film, film);
      const savedFilm = writeFilm(slug, updatedFilm);

      return jsonResult({
        slug,
        applied: true,
        dryRun: false,
        plan: planResult.plan,
        ops: planResult.ops,
        attempts: planResult.attempts,
        warnings: planResult.warnings,
        filmSummary: {
          id: savedFilm.id,
          title: savedFilm.title,
          shots: savedFilm.shots.length,
          accent: savedFilm.accent,
          durationSec: Number(savedFilm.shots.reduce((sum, s) => sum + s.dur, 0).toFixed(2)),
        },
      });
    },
  );

  server.registerTool(
    "aideos_get_pending_tasks",
    {
      title: "Get pending agent tasks",
      description:
        "Fetch pending directing, voiceover, screenplay, and editing tasks dispatched from Aideos Studio. " +
        "Filter by film slug if provided.",
      inputSchema: {
        filmId: z.string().optional().describe("Optional package slug under videos/ to filter pending tasks."),
      },
    },
    async ({ filmId }) => {
      const tasks = taskQueue.listPendingTasks(filmId);
      return jsonResult({
        count: tasks.length,
        tasks,
      });
    },
  );

  server.registerTool(
    "aideos_claim_task",
    {
      title: "Claim an agent task",
      description:
        "Claim a pending task to begin autonomous execution and prevent hybrid timeout fallback.",
      inputSchema: {
        taskId: z.string().describe("The unique task ID to claim."),
        agentId: z.string().optional().describe("Identifier of the agent claiming the task. Defaults to 'agent'."),
      },
    },
    async ({ taskId, agentId }) => {
      try {
        const task = taskQueue.claimTask(taskId, agentId);
        return jsonResult({ ok: true, task: taskSummary(task) });
      } catch (err: any) {
        return jsonResult({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  if (options.link) {
    const link = options.link;
    server.registerTool(
      "aideos_wait_for_task",
      {
        title: "Wait for the next studio task",
        description:
          "Block until the Aideos studio sends this agent a task, or about 40 seconds pass. Returns the task with full instructions, " +
          "or a note to call this tool again. Do the task with the aideos tools, finish with aideos_complete_task, then call this again. " +
          "Keep calling it until it says the studio disconnected: that is how this agent stays linked to the studio.",
        inputSchema: {},
      },
      async () => {
        const task = await link.waitForTask(40_000);
        if (task === "ended") return jsonResult({ status: "disconnected", message: "The studio ended this link (disconnected, replaced by another agent, or the studio tab was closed). Stop calling this tool." });
        if (!task) return jsonResult({ status: "idle", message: "No task yet. Call aideos_wait_for_task again." });
        return jsonResult({ status: "task", taskId: task.id, eventType: task.eventType, filmId: task.filmId, instructions: task.prompt });
      },
    );
  }

  server.registerTool(
    "aideos_complete_task",
    {
      title: "Complete an agent task",
      description:
        "Mark a claimed agent task as completed with summary and optional execution results.",
      inputSchema: {
        taskId: z.string().describe("The unique task ID being completed."),
        summary: z.string().optional().describe("Brief description of actions taken and files modified."),
        result: z.record(z.string(), z.any()).optional().describe("Optional JSON data or modified artifact metadata."),
      },
    },
    async ({ taskId, summary, result }) => {
      try {
        const task = taskQueue.completeTask(taskId, { summary, ...(result || {}) });
        options.link?.complete(taskId, summary, true);
        return jsonResult({ ok: true, task: taskSummary(task) });
      } catch (err: any) {
        return jsonResult({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  server.registerTool(
    "aideos_report_step",
    {
      title: "Report execution step to live Agent Trace",
      description:
        "Report an autonomous tool call, reasoning step, research discovery, or invariant verification " +
        "to the Aideos Studio live Agent Trace timeline streamed to the user via SSE.",
      inputSchema: {
        title: z.string().min(1).describe("Short title of the step or action taken."),
        description: z.string().optional().describe("Detailed explanation of what was done or discovered."),
        phase: z
          .enum([
            "grounding",
            "synthesis",
            "authoring",
            "validation",
            "ai_edit",
            "broll",
            "dispatch",
            "complete",
          ])
          .optional()
          .describe("Phase category for this step. Defaults to 'authoring'."),
        status: z
          .enum(["pending", "running", "done", "corrected", "failed"])
          .optional()
          .describe("Current execution status. Defaults to 'done'."),
        details: z
          .array(z.string())
          .optional()
          .describe("Optional list of technical sub-steps, code snippets, or rule verification checks."),
        source: z
          .string()
          .optional()
          .describe("Originating entity, defaults to 'agent'."),
        filmId: z
          .string()
          .optional()
          .describe("Optional film slug this step relates to."),
        durationMs: z
          .number()
          .optional()
          .describe("Optional execution duration in milliseconds."),
      },
    },
    async (input) => {
      const step = traceBus.recordStep({
        title: input.title,
        description: input.description || "",
        phase: input.phase || "authoring",
        status: input.status || "done",
        details: input.details,
        source: input.source || "agent",
        filmId: input.filmId,
        durationMs: input.durationMs,
      });
      return jsonResult({ ok: true, stepId: step.id, step });
    },
  );

  registerDesignTools(server);

  return server;
}

/** Starts the MCP server on stdio and keeps it running until the transport closes. */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
