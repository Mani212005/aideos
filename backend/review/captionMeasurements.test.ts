/**
 * File Description: Exercises caption measurement while inherited desktop D-Bus endpoints cannot authenticate.
 * Inputs and outputs: a stalled private Unix socket and real Chrome -> measured words without desktop IPC.
 * Used by: the CI unit test glob.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findChromeBinary } from "../scene/renderStill";

// Terminates only the test worker's process group, allowing for a child that already exited.
function killWorkerGroup(pid: number): void {
  try { process.kill(-pid, "SIGKILL"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

// Runs one public measurer in its own process so a blocked synchronous browser cannot hang the test runner.
async function measureWithoutDesktopBus(mode: "sync" | "async"): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "caption-bus-"));
  const socketPath = path.join(directory, "bus");
  const sockets = new Set<net.Socket>();
  let rejectConnection: (error: Error) => void = () => undefined;
  const connected = new Promise<never>((_, reject) => {
    rejectConnection = reject;
  });
  // Accepts connections without authenticating, reproducing the Chrome startup stall.
  const server = net.createServer((socket) => {
    sockets.add(socket);
    rejectConnection(new Error("Caption Chrome attempted desktop D-Bus authentication"));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const modulePath = path.join(__dirname, "captionMeasurements.ts");
  const method = mode === "sync" ? "measureCaptionWords" : "measureCaptionWordsAsync";
  const program = `const {${method}}=require(${JSON.stringify(modulePath)}); Promise.resolve(${method}(['Visible','phrase'],45)).then(value=>process.stdout.write(JSON.stringify(value)),error=>{console.error(error);process.exitCode=1;});`;
  const worker = spawn(process.execPath, ["--import", "tsx", "--eval", program], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${socketPath}`,
      DBUS_SYSTEM_BUS_ADDRESS: `unix:path=${socketPath}`,
    },
  });
  let stdout = "";
  let stderr = "";
  worker.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  worker.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const completed = new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Caption worker exited ${code}: ${stderr}`));
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Caption worker did not finish")), 29000);
  });
  try {
    await Promise.race([completed, connected, deadline]);
    assert.equal(sockets.size, 0);
    const result = JSON.parse(stdout) as Record<string, number>;
    assert.deepEqual(Object.keys(result).sort(), ["Visible", "phrase"]);
    assert.ok(result.Visible > 0 && result.phrase > 0);
  } finally {
    if (timer) clearTimeout(timer);
    // Kills only this worker's process group, including a Chrome blocked before its own signal handler can run.
    if (worker.pid && worker.exitCode === null) {
      killWorkerGroup(worker.pid);
    }
    for (const socket of sockets) socket.destroy();
    await completed.catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Both entry points must measure locally even when a desktop bus accepts connections but never answers.
for (const mode of ["sync", "async"] as const) {
  test(`${mode} caption measurement does not depend on desktop D-Bus authentication`, {
    skip: process.platform !== "linux" || !findChromeBinary(),
    timeout: 30000,
  }, () => measureWithoutDesktopBus(mode));
}
