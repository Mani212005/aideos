/**
 * File Description: Per-pane prompt queue for terminal coding agents (claude, codex, any tmux pane with a prompt).
 * A prompt is sent only when the agent is idle at an empty prompt, otherwise it waits as queued. Sending is
 * paste, a short pause, Enter, then a check that the agent took it, with one retry of the Enter. Terminal agent
 * UIs ignore an Enter that arrives right after a large paste, so an immediate Enter leaves the prompt unsent.
 * Identical prompts still pending for the same pane are dropped. For an idempotent Auto-Prompt dispatch, an existing
 * task counts as open only while younger than OPEN_AFTER_TIMEOUT_MS (10 minutes, measured from when the task was created
 * or last sent) regardless of whether it is pending, claimed, or timed out with a sent pane; completed or failed tasks,
 * or those whose pane delivery failed, are not open. Non-idempotent dispatches keep the pending-only pane twin rule and
 * are never merged.
 * Inputs and outputs: prompt text, tmux pane id and an injectable tmux runner -> a delivery snapshot that moves queued -> sending -> sent or failed.
 * Used by: backend/agentBridge/dispatcher.ts, editor/vite.config.ts.
 */

import { readPaneScreen, type PaneScreenState } from "./paneScreen";

/** A tmux command runner; `stdout` is needed for capture-pane. */
export type PaneTmuxRun = (args: string[]) => { status: number | null; stdout?: string };

export type PaneDeliveryState = "queued" | "sending" | "sent" | "failed";

/** Timing knobs in ms; the defaults suit real agent UIs and tests inject small ones. */
export interface PaneTiming {
  /** How often a queued prompt re-checks whether the agent is idle. */
  pollMs: number;
  /** The pause between the paste and the Enter, so the UI can fold the paste in. */
  settleMs: number;
  /** The longer pause before the one retry of the Enter. */
  retrySettleMs: number;
  /** How long to watch for the agent to take the prompt after an Enter. */
  verifyMs: number;
  /** How often to look during that watch. */
  verifyPollMs: number;
  /** A screen with no recognizable prompt is sent to anyway after this many polls, unverified. */
  unknownPollsBeforeSend: number;
  /** A prompt still waiting after this long is given up on. */
  expireMs: number;
}

/**
 * How long an idempotent task (Auto-Prompt) still counts as open, measured from when it was created or last sent:
 * within this window a repeated click reuses the open task and never types the prompt twice, while after the
 * window a click creates a new task.
 */
export const OPEN_AFTER_TIMEOUT_MS = 10 * 60 * 1000;

export const DEFAULT_PANE_TIMING: PaneTiming = {
  pollMs: 1000,
  settleMs: 400,
  retrySettleMs: 1500,
  verifyMs: 1500,
  verifyPollMs: 250,
  unknownPollsBeforeSend: 3,
  expireMs: 30 * 60 * 1000,
};

export interface PaneDeliveryDeps {
  tmux: PaneTmuxRun;
  /** Waits ms; tests pass a virtual clock. */
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds now; tests pass a virtual clock. */
  now?: () => number;
  timing?: Partial<PaneTiming>;
}

export interface PaneDeliveryRequest {
  pane: string;
  agent: string;
  prompt: string;
  taskId?: string;
  /** An idempotent request also counts a recently sent identical prompt as its twin, not only a pending one. */
  idempotent?: boolean;
}

/** What callers and the studio see of one prompt: never the prompt text itself. */
export interface PaneDelivery {
  id: string;
  pane: string;
  agent: string;
  taskId?: string;
  state: PaneDeliveryState;
  /** True when an identical prompt was already pending, so this one was dropped. */
  duplicate: boolean;
  /** Enters sent so far (2 means the retry ran). */
  attempts: number;
  /** True when the agent was seen taking the prompt; false when the screen could not be read. */
  verified: boolean;
  /** Why a queued prompt is still waiting: the screen state it last saw. */
  waitingFor?: PaneScreenState;
  error?: string;
  /** When the prompt was sent, on the queue's clock. */
  sentAtMs?: number;
}

interface Entry extends PaneDelivery {
  prompt: string;
  queuedAtMs: number;
  unknownPolls: number;
  /** True once the prompt's task completed or failed, so a sent prompt no longer blocks the same one again. */
  released: boolean;
  run: Required<Omit<PaneDeliveryDeps, "timing">> & { timing: PaneTiming };
}

const PENDING: PaneDeliveryState[] = ["queued", "sending"];
const KEEP_FINISHED = 50;

/** The real wait: a timer that never keeps the process alive. */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === "function") timer.unref();
  });
}

/** Queues prompts per pane and delivers them one at a time when the agent is idle. */
export class PaneDeliveryQueue {
  private entries: Entry[] = [];
  private pumps = new Map<string, Promise<void>>();
  private nextId = 1;

  /** Queues a prompt for a pane, or drops it when an identical one is pending or recently sent; starts delivery at once. */
  enqueue(req: PaneDeliveryRequest, deps: PaneDeliveryDeps): PaneDelivery {
    const run = {
      tmux: deps.tmux,
      sleep: deps.sleep ?? realSleep,
      now: deps.now ?? Date.now,
      timing: { ...DEFAULT_PANE_TIMING, ...deps.timing },
    };
    const twin = this.entries.find((e) => e.pane === req.pane && e.prompt === req.prompt && this.blocks(e, req, run.now()));
    if (twin) return { ...this.snapshot(twin), duplicate: true };

    const entry: Entry = {
      id: `pane-${Date.now().toString(36)}-${this.nextId++}`,
      pane: req.pane,
      agent: req.agent,
      taskId: req.taskId,
      prompt: req.prompt,
      state: "queued",
      duplicate: false,
      attempts: 0,
      verified: false,
      queuedAtMs: run.now(),
      unknownPolls: 0,
      released: false,
      run,
    };
    this.entries.push(entry);
    this.prune();
    if (!this.pumps.has(req.pane)) {
      const pump = this.pump(req.pane)
        .catch((err) => this.failPane(req.pane, `Delivery stopped: ${String(err)}`))
        .finally(() => this.pumps.delete(req.pane));
      this.pumps.set(req.pane, pump);
    }
    return this.snapshot(entry);
  }

  /** The current snapshot of one delivery. */
  get(id: string): PaneDelivery | undefined {
    const entry = this.entries.find((e) => e.id === id);
    return entry ? this.snapshot(entry) : undefined;
  }

  /** Snapshots of the recent deliveries, newest first, optionally for one pane. */
  list(pane?: string): PaneDelivery[] {
    return this.entries
      .filter((e) => !pane || e.pane === pane)
      .map((e) => this.snapshot(e))
      .reverse();
  }

  /** Resolves when every pane has nothing left to send. */
  async drain(): Promise<void> {
    while (this.pumps.size > 0) await Promise.all([...this.pumps.values()]);
  }

  /** Marks a task's sent prompts as settled once the task completed or failed, so the same prompt can be sent again. */
  release(taskId: string): void {
    for (const e of this.entries) if (e.taskId === taskId) e.released = true;
  }

  /** Forgets everything (tests). */
  clear(): void {
    this.entries = [];
  }

  /** True while an entry stops an identical prompt: it is pending, or, for an idempotent request, sent within the open window and not released. */
  private blocks(e: Entry, req: PaneDeliveryRequest, nowMs: number): boolean {
    if (PENDING.includes(e.state)) return true;
    if (!req.idempotent || e.state !== "sent" || e.released || e.sentAtMs === undefined) return false;
    return nowMs - e.sentAtMs <= OPEN_AFTER_TIMEOUT_MS;
  }

  /** A caller-safe copy of an entry. */
  private snapshot(e: Entry): PaneDelivery {
    return {
      id: e.id,
      pane: e.pane,
      agent: e.agent,
      taskId: e.taskId,
      state: e.state,
      duplicate: e.duplicate,
      attempts: e.attempts,
      verified: e.verified,
      waitingFor: e.waitingFor,
      error: e.error,
      sentAtMs: e.sentAtMs,
    };
  }

  /** Drops the oldest finished entries so history stays bounded. */
  private prune(): void {
    const finished = this.entries.filter((e) => !PENDING.includes(e.state));
    for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) {
      this.entries.splice(this.entries.indexOf(old), 1);
    }
  }

  /** Sends a pane's queued prompts in order, each only once the agent is idle at an empty prompt. */
  private async pump(pane: string): Promise<void> {
    for (;;) {
      const head = this.entries.find((e) => e.pane === pane && e.state === "queued");
      if (!head) return;
      const { tmux, sleep, now, timing } = head.run;
      if (now() - head.queuedAtMs > timing.expireMs) {
        this.fail(head, "The agent never became idle, so the prompt was not sent.");
        continue;
      }
      const snap = tmux(["capture-pane", "-p", "-e", "-t", pane]);
      if (snap.status !== 0) return this.failPane(pane, "The terminal pane is gone.");
      const reading = readPaneScreen(snap.stdout);
      head.unknownPolls = reading.state === "unknown" ? head.unknownPolls + 1 : 0;
      head.waitingFor = reading.state;
      const unreadable = reading.state === "unknown" && head.unknownPolls >= timing.unknownPollsBeforeSend;
      if (reading.state === "idle" || unreadable) {
        await this.deliver(head, !unreadable);
      } else {
        await sleep(timing.pollMs);
      }
    }
  }

  /** Paste, pause, Enter, then check the agent took it; one retry of the Enter when it did not. */
  private async deliver(e: Entry, observable: boolean): Promise<void> {
    const { tmux, sleep, timing } = e.run;
    e.state = "sending";
    e.waitingFor = undefined;
    const buffer = `aideos_${e.id}`;
    if (tmux(["set-buffer", "-b", buffer, e.prompt]).status !== 0 || tmux(["paste-buffer", "-b", buffer, "-t", e.pane, "-d"]).status !== 0) {
      return this.fail(e, "Could not paste the prompt into the terminal pane.");
    }
    await sleep(timing.settleMs);
    if (!this.pressEnter(e)) return this.fail(e, "Could not press Enter in the terminal pane.");
    if (!observable) return this.finish(e, false);

    let outcome = await this.watchAccepted(e);
    if (outcome === "rejected") {
      // The paste is still in the input: the Enter was swallowed. Wait longer, then press it again.
      await sleep(timing.retrySettleMs);
      if (this.read(e).state !== "typing") outcome = "accepted";
      else if (!this.pressEnter(e)) return this.fail(e, "Could not press Enter in the terminal pane.");
      else outcome = await this.watchAccepted(e);
    }
    if (outcome === "rejected") {
      return this.fail(e, "The prompt is in your agent's input but was not submitted. Press Enter in the terminal to send it.");
    }
    this.finish(e, outcome === "accepted");
  }

  /** Presses Enter once and counts it. */
  private pressEnter(e: Entry): boolean {
    e.attempts += 1;
    return e.run.tmux(["send-keys", "-t", e.pane, "Enter"]).status === 0;
  }

  /** Reads the pane's screen now. */
  private read(e: Entry) {
    return readPaneScreen(e.run.tmux(["capture-pane", "-p", "-e", "-t", e.pane]).stdout);
  }

  /** Watches after an Enter: accepted once the agent is working or its input is empty, rejected if the paste is still in the input. */
  private async watchAccepted(e: Entry): Promise<"accepted" | "rejected" | "unverified"> {
    const { sleep, timing } = e.run;
    for (let waited = 0; ; waited += timing.verifyPollMs) {
      const state = this.read(e).state;
      if (state === "busy" || state === "idle") return "accepted";
      if (state === "unknown") return "unverified";
      if (waited >= timing.verifyMs) return "rejected";
      await sleep(timing.verifyPollMs);
    }
  }

  /** Marks a prompt as sent. */
  private finish(e: Entry, verified: boolean): void {
    e.state = "sent";
    e.verified = verified;
    e.sentAtMs = e.run.now();
  }

  /** Fails every prompt of a pane that has not been sent. */
  private failPane(pane: string, error: string): void {
    for (const e of this.entries) if (e.pane === pane && PENDING.includes(e.state)) this.fail(e, error);
  }

  /** Marks a prompt as failed with the reason the studio shows. */
  private fail(e: Entry, error: string): void {
    e.state = "failed";
    e.error = error;
    e.waitingFor = undefined;
  }
}

/** The process-wide pane delivery queue. */
export const paneDelivery = new PaneDeliveryQueue();
