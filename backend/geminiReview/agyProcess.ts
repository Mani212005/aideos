/**
 * File Description: Bounded agy execution with process-group cleanup and an idle watchdog.
 * Inputs and outputs: agy arguments and deadlines -> captured output or a reaped failure.
 * Used by: backend/geminiReview/geminiReview.ts.
 */

import { execFile, execFileSync, spawn } from "node:child_process";

// Builds the Windows tree-termination command, reserving force for final cleanup.
export function taskkillArgs(pid: number, signal: NodeJS.Signals): string[] {
  return ["/PID", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])];
}

// Measures CPU used by this process group; an unavailable ps disables only the idle heuristic.
async function groupCpuSeconds(group: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile("ps", ["-axo", "pgid=,time="], { timeout: 1000, killSignal: "SIGKILL" }, (error, stdout) => {
      if (error) return resolve(undefined);
      let total = 0;
      for (const line of stdout.trim().split("\n")) {
        const [pgid, time] = line.trim().split(/\s+/);
        if (Number(pgid) !== group || !time) continue;
        const [days, clock] = time.includes("-") ? time.split("-") : ["0", time];
        total += Number(days) * 86400 + clock.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
      }
      resolve(Number.isFinite(total) ? total : undefined);
    });
  });
}

// Runs agy with a real wall-clock deadline, escalating SIGTERM even if its leader exits first.
export function runAgyProcess(
  args: string[],
  options: { cwd?: string; timeoutSeconds: number; idleTimeoutSeconds?: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("agy", args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let stopping: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let lastActivity = Date.now();
    let lastCpu: number | undefined;
    let polling = false;
    let settled = false;

    // Signals the entire child tree, including descendants retaining the output pipes.
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", taskkillArgs(child.pid, signal), { stdio: "ignore", timeout: 1000 });
        } else process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };

    // Reaps the detached group on normal exit as well as explicit parent termination.
    const onExit = () => killGroup("SIGKILL");
    // Preserves the conventional interrupt exit code after killing the review tree.
    const onInterrupt = () => { onExit(); process.exit(130); };
    // Preserves the conventional termination exit code after killing the review tree.
    const onTerminate = () => { onExit(); process.exit(143); };
    process.once("exit", onExit);
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);

    // Releases every timer and parent hook after the group has been reaped.
    const cleanup = () => {
      settled = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      clearInterval(watchdog);
      process.removeListener("exit", onExit);
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    };

    // Allows a short graceful shutdown, then kills stubborn descendants and rejects independently of close.
    const stop = (error: Error) => {
      if (stopping || settled) return;
      stopping = error;
      killGroup("SIGTERM");
      escalation = setTimeout(() => {
        killGroup("SIGKILL");
        cleanup();
        reject(error);
      }, 1000);
    };

    const deadline = setTimeout(() => stop(new Error(`agy review timed out after ${options.timeoutSeconds}s; terminated its process group.`)), options.timeoutSeconds * 1000);

    // Fails idle reviews early only when neither stdout nor group CPU has advanced.
    const poll = async () => {
      if (polling || stopping || settled || !child.pid || process.platform === "win32") return;
      polling = true;
      const cpu = await groupCpuSeconds(child.pid);
      polling = false;
      if (stopping || settled || cpu === undefined) return;
      if (lastCpu === undefined || cpu > lastCpu) lastActivity = Date.now();
      lastCpu = cpu;
      if (Date.now() - lastActivity >= options.idleTimeoutSeconds * 1000) {
        stop(new Error(`agy appears wedged: no stdout or CPU growth for ${options.idleTimeoutSeconds}s; terminated its process group. See aideos issue #125.`));
      }
    };
    const watchdog = options.idleTimeoutSeconds === undefined
      ? undefined
      : setInterval(() => { void poll(); }, Math.min(30000, options.idleTimeoutSeconds! * 500));

    // Bounds captured output while counting stdout as progress for the idle watchdog.
    const observe = (chunk: Buffer, output: "stdout" | "stderr") => {
      bytes += chunk.length;
      if (bytes > 50 * 1024 * 1024) {
        stop(new Error("agy review failed: output exceeded 50 MiB."));
        return;
      }
      if (output === "stdout") { stdout += chunk.toString(); lastActivity = Date.now(); }
      else stderr += chunk.toString();
    };
    child.stdout.on("data", (chunk: Buffer) => observe(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => observe(chunk, "stderr"));
    child.once("error", (error) => {
      if (stopping || settled) return;
      killGroup("SIGKILL");
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      if (stopping || settled) return;
      killGroup("SIGKILL");
      cleanup();
      resolve({ stdout, stderr, code });
    });
  });
}
