/**
 * File Description: VideoEngine adapter that drives a standalone Wan2GP install
 * on a remote GPU box over SSH (headless CLI transport, report section 3.3).
 * Submits job JSON via scp, launches wgp.py --process under tmux, polls the
 * render log, and rsyncs finished clips back. Phase 1 transport.
 */
import { spawn } from "child_process";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import type { VideoEngine, VideoJobHandle, VideoJobSpec, VideoJobStatus } from "./types";
import { loadProfile } from "./profiles";

/** Remote layout, all user-space paths on the GPU box. */
const REMOTE_WGP_DIR = process.env.WAN_GPU_WGP_DIR || "~/Wan2GP";
const REMOTE_PYTHON = process.env.WAN_GPU_PYTHON || "~/wangp-env/bin/python";
const REMOTE_JOBS_DIR = process.env.WAN_GPU_JOBS_DIR || "~/wangp-jobs";
const REMOTE_OUT_ROOT = process.env.WAN_GPU_OUT_ROOT || "~/wangp-out";

/** Connection facts for the GPU box; the password only ever travels via env. */
const host = () => process.env.WAN_GPU_HOST || "100.98.174.122";
const user = () => process.env.WAN_GPU_USER || "s03714802824";

/** Dedicated keyfile path; installed once by the runbook recipe. */
const keyFile = () => path.join(os.homedir(), ".ssh", "wan_gpu_key");

/** True when passwordless key auth to the box is available. */
function hasKeyAuth(): boolean {
  return fsSync.existsSync(keyFile());
}

/** Common ssh options: batch mode with the key, or accept-new when falling back. */
function sshOpts(extra: string[] = []): string[] {
  const base = hasKeyAuth()
    ? ["-i", keyFile(), "-o", "BatchMode=yes"]
    : ["-o", "StrictHostKeyChecking=accept-new"];
  return [...base, ...extra];
}

/** Frames-per-second Wan2.1 T2V generates at natively. */
const NATIVE_FPS = 16;

/** Spawn a local process and collect its combined output. */
function runProcess(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

/**
 * Run an interactive binary under /usr/bin/expect so the SSH password prompt
 * is answered from the environment without ever touching argv or disk.
 * The spawned argv travels in WAN_GPU_EXPECT_ARGV (a Tcl list) so no shell or
 * Tcl quoting ever touches job data.
 */
async function runExpect(cmd: string, args: string[], timeoutSec: number): Promise<{ code: number; out: string }> {
  if (!process.env.WAN_GPU_PASSWORD) {
    throw new Error("WAN_GPU_PASSWORD is not set and no SSH key exists; cannot reach the GPU box.");
  }
  // Tcl-list encode each element: bare when simple, brace-quoted otherwise.
  const tcl = (s: string) => (/^[^\s{}$"\\]*$/.test(s) ? s : `{${s}}`);
  const argvList = [cmd, ...args].map(tcl).join(" ");
  const script = [
    `set timeout ${timeoutSec}`,
    `set pw $env(WAN_GPU_PASSWORD)`,
    `set argv_list $env(WAN_GPU_EXPECT_ARGV)`,
    `spawn {*}$argv_list`,
    `expect {`,
    `  -re "(P|p)assword:" { send "$pw\\r"; exp_continue }`,
    `  eof`,
    `}`,
    `catch wait result`,
    `exit [lindex $result 3]`,
  ].join("\n");
  const res = await runProcess("/usr/bin/expect", ["-c", script], {
    ...process.env,
    WAN_GPU_EXPECT_ARGV: argvList,
  });
  return { code: res.code, out: clean(res.out) };
}

/** Run a command directly under key auth, or under expect with password auth. */
function runTransfer(cmd: string, args: string[], timeoutSec: number): Promise<{ code: number; out: string }> {
  if (hasKeyAuth()) return runProcess(cmd, args);
  return runExpect(cmd, args, timeoutSec);
}

/** Strip expect's own "spawn ..." echo line so logs stay readable. */
function clean(out: string): string {
  return out
    .split("\n")
    .filter((l) => !/^spawn /i.test(l))
    .join("\n")
    .trim();
}

/** Run a shell command on the GPU box over ssh. */
async function ssh(command: string, timeoutSec = 60): Promise<{ code: number; out: string }> {
  if (hasKeyAuth()) {
    return runProcess("ssh", [...sshOpts(["-o", "ConnectTimeout=15"]), `${user()}@${host()}`, command]);
  }
  return runExpect(
    "ssh",
    ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15", `${user()}@${host()}`, command],
    timeoutSec,
  );
}

/** Copy a local file to the GPU box with scp. */
async function scpTo(localPath: string, remotePath: string): Promise<void> {
  const res = await runTransfer("scp", [...sshOpts(), localPath, `${user()}@${host()}:${remotePath}`], 120);
  if (res.code !== 0) throw new Error(`scp failed:\n${clean(res.out)}`);
}

/** Quote a remote path so spaces survive the remote shell during transfers. */
function quoteRemote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

/** rsync a remote path (file or dir) into a local directory. */
async function rsyncBack(remotePath: string, localDir: string): Promise<string> {
  await fs.mkdir(localDir, { recursive: true });
  const res = await runTransfer(
    "rsync",
    [
      "-av",
      "--partial",
      "-e",
      `ssh ${sshOpts().join(" ")}`,
      `${user()}@${host()}:${quoteRemote(remotePath)}`,
      `${localDir}/`,
    ],
    600,
  );
  if (res.code !== 0) throw new Error(`rsync failed:\n${clean(res.out)}`);
  return localDir;
}

/** Turn a VideoJobSpec into a concrete WanGP settings JSON object. */
export async function buildJobParams(spec: VideoJobSpec): Promise<Record<string, unknown>> {
  const profile = await loadProfile(spec.modelProfile);
  // Wan2.1 needs frame counts of the form 4k+1; snap toward the requested length.
  const rawFrames = Math.round(spec.seconds * NATIVE_FPS);
  const frames = Math.max(5, Math.floor((rawFrames - 1) / 4) * 4 + 1);
  return {
    ...profile.params,
    prompt: spec.prompt,
    ...(spec.negativePrompt ? { negative_prompt: spec.negativePrompt } : {}),
    ...(spec.seed !== undefined ? { seed: spec.seed } : {}),
    video_length: frames,
  };
}

/** Engine that renders clips by driving WanGP headless on the box. */
export class SshWanGPEngine implements VideoEngine {
  name = "ssh-wangp";

  /** Write the resolved settings JSON to the box spool dir and launch tmux. */
  async submit(spec: VideoJobSpec): Promise<VideoJobHandle> {
    const jobId = `aideos-${Date.now().toString(36)}`;
    const params = await buildJobParams(spec);
    const tmp = path.join(os.tmpdir(), `${jobId}.json`);
    // A .json settings file is the bare params dict; the {id, params} wrapper
    // shape is only for full queue manifests and would be double-wrapped here.
    await fs.writeFile(tmp, JSON.stringify(params, null, 2));
    await ssh(`mkdir -p ${REMOTE_JOBS_DIR} ${REMOTE_OUT_ROOT}/${jobId}`);
    await scpTo(tmp, `${REMOTE_JOBS_DIR}/${jobId}.json`);
    await fs.unlink(tmp);
    const launch =
      `tmux new-session -d -s wangp-${jobId} ` +
      `'cd ${REMOTE_WGP_DIR} && ${REMOTE_PYTHON} wgp.py --process ${REMOTE_JOBS_DIR}/${jobId}.json ` +
      `--output-dir ${REMOTE_OUT_ROOT}/${jobId} > ${REMOTE_JOBS_DIR}/${jobId}.log 2>&1'`;
    const res = await ssh(launch);
    if (res.code !== 0) throw new Error(`failed to launch tmux session for ${jobId}:\n${res.out}`);
    return { jobId };
  }

  /** Inspect the remote tmux session and render log for lifecycle state. */
  async status(jobId: string): Promise<VideoJobStatus> {
    const sess = await ssh(`tmux has-session -t wangp-${jobId} 2>/dev/null; echo $?`);
    const alive = sess.out.trim().endsWith("0");
    const log = await ssh(
      `tail -c 4000 ${REMOTE_JOBS_DIR}/${jobId}.log 2>/dev/null || true; echo ---; ` +
        `find ${REMOTE_OUT_ROOT}/${jobId} -name '*.mp4' 2>/dev/null | head -1`,
      120,
    );
    const [logPart, mp4Part] = log.out.split(/^---$/m);
    if (mp4Part && mp4Part.trim()) return { state: "done", progress: 1 };
    if (/Queue completed/i.test(logPart)) return { state: "done", progress: 1 };
    if (!alive && !/Queue completed/i.test(logPart)) {
      return { state: "failed", error: `render session ended without success; log tail:\n${logPart.slice(-800)}` };
    }
    // Progress: last "[N/M]" step marker in the denoise log, if any.
    const step = [...logPart.matchAll(/\[(\d+)\/(\d+)\]/g)].pop();
    const progress = step ? Math.min(0.99, Number(step[1]) / Number(step[2])) : undefined;
    return { state: alive ? "running" : "queued", progress };
  }

  /** rsync the finished clip back and return nothing; throws if no mp4 exists. */
  async fetchOutput(jobId: string, destPath: string): Promise<void> {
    const probe = await ssh(`find ${REMOTE_OUT_ROOT}/${jobId} -name '*.mp4' 2>/dev/null | head -1`, 120);
    const remoteFile = probe.out.trim();
    if (!remoteFile) throw new Error(`no mp4 produced for job ${jobId}`);
    const staging = path.join(os.tmpdir(), `aideos-fetch-${jobId}`);
    await rsyncBack(remoteFile, staging);
    const files = await fs.readdir(staging);
    const mp4 = files.find((f) => f.endsWith(".mp4"));
    if (!mp4) throw new Error(`rsync returned no mp4 for job ${jobId}`);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.rename(path.join(staging, mp4), destPath);
    await fs.rm(staging, { recursive: true, force: true });
  }

  /** Kill the remote tmux session for this job. */
  async cancel(jobId: string): Promise<void> {
    await ssh(`tmux kill-session -t wangp-${jobId} 2>/dev/null || true`);
  }
}
