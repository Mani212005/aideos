/**
 * File Description: Core types for the Aideos GPU video engine abstraction.
 * Defines VideoJobSpec, VideoJobHandle and the swappable VideoEngine interface
 * that decouples Aideos from any specific generation backend (report section 3.3).
 */

/** What Aideos wants rendered. Engine-agnostic by design. */
export interface VideoJobSpec {
  /** Self-contained text-to-video prompt for the diffusion model. */
  prompt: string;
  negativePrompt?: string;
  /** Target clip duration in seconds. */
  seconds: number;
  width: number;
  height: number;
  fps: number;
  seed?: number;
  /** Maps to a pinned settings template under backend/engine/profiles/. */
  modelProfile: "small" | "mid";
}

/** Opaque per-job identifier returned by an engine on submit. */
export interface VideoJobHandle {
  jobId: string;
}

/** Lifecycle state of a submitted job, as reported by the engine. */
export interface VideoJobStatus {
  state: "queued" | "running" | "done" | "failed";
  /** 0..1 when the engine can observe progress. */
  progress?: number;
  error?: string;
}

/**
 * The entire swap surface between Aideos and a generation backend.
 * NullEngine today, SshWanGPEngine now, McpWanGPEngine later; callers
 * depend only on this interface.
 */
export interface VideoEngine {
  name: string;
  submit(spec: VideoJobSpec): Promise<VideoJobHandle>;
  status(jobId: string): Promise<VideoJobStatus>;
  /** Copy the finished mp4 for jobId to destPath (a full file path). */
  fetchOutput(jobId: string, destPath: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
}
