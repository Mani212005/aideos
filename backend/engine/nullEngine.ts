/**
 * File Description: Placeholder VideoEngine that simulates the job lifecycle
 * with zero GPU and zero network. Keeps the whole pipeline testable offline
 * (report section 3.3).
 */
import fs from "fs/promises";
import path from "path";
import type { VideoEngine, VideoJobHandle, VideoJobSpec, VideoJobStatus } from "./types";

/** Simulated engine: jobs complete instantly; fetchOutput writes an empty marker mp4. */
export class NullEngine implements VideoEngine {
  name = "null";
  private jobs = new Map<string, { spec: VideoJobSpec; state: VideoJobStatus["state"] }>();
  private counter = 0;

  /** Record a job and mark it done immediately. */
  async submit(spec: VideoJobSpec): Promise<VideoJobHandle> {
    const jobId = `null-${Date.now().toString(36)}-${(this.counter++).toString(36)}`;
    this.jobs.set(jobId, { spec, state: "done" });
    return { jobId };
  }

  /** Report the in-memory state of a previously submitted job. */
  async status(jobId: string): Promise<VideoJobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) return { state: "failed", error: `unknown job: ${jobId}` };
    return { state: job.state, progress: job.state === "done" ? 1 : 0 };
  }

  /** Touch destPath so callers have a real file to point at. */
  async fetchOutput(jobId: string, destPath: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== "done") throw new Error(`no output for job: ${jobId}`);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, "");
  }

  /** Forget a job. */
  async cancel(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }
}
