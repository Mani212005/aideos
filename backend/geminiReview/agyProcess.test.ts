/**
 * File Description: Executable regressions for agy JSON replies and process-tree cleanup.
 * Inputs and outputs: local agy stand-ins -> review results, failures, and surviving process checks.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { defaultAgyRunner, reviewVideo } from "./geminiReview";

// Reports whether a fixture process is still alive.
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Installs a local executable and reaps every fixture process even when the regression fails.
function fakeAgy(t: TestContext, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-agy-process-"));
  fs.writeFileSync(path.join(dir, "agy"), `#!/usr/bin/env node\n${body}`, { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${savedPath ?? ""}`;
  t.after(() => {
    process.env.PATH = savedPath;
    for (const name of ["child.pid", "leader.pid"]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) {
        try { process.kill(Number(fs.readFileSync(file, "utf8")), "SIGKILL"); } catch {}
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Waits a bounded time for an observable process state.
async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await delay(30);
  }
  assert.fail("fixture process state did not converge within three seconds");
}

const stubbornTree = `
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const dir = __dirname;
process.on('SIGTERM', () => {});
fs.writeFileSync(path.join(dir, 'leader.pid'), String(process.pid));
spawn(process.execPath, ['-e', \`process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(\${JSON.stringify(path.join(dir, 'child.pid'))}, String(process.pid)); setInterval(() => {}, 1000);\`], {stdio: 'inherit'});
setInterval(() => {}, 1000);
`;

test("agy runner requests text JSON without the broken schema flag", async (t) => {
  const dir = fakeAgy(t, `
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'args.json'), JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({status: 'SUCCESS', response: '\`\`\`json\\n{"rating":7.5}\\n\`\`\`', conversation_id: 'watch-1'}));
`);
  const result = JSON.parse(await defaultAgyRunner("Watch video.mp4", { model: "configured-judge", schema: { type: "object" }, timeoutSeconds: 5 }));
  assert.equal(result.rating, 7.5);
  assert.equal(result.conversation_id, "watch-1");
  const args: string[] = JSON.parse(fs.readFileSync(path.join(dir, "args.json"), "utf8"));
  assert.equal(args.includes("--json-schema"), false);
  assert.equal(args[args.indexOf("--model") + 1], "configured-judge");
  assert.match(args[args.indexOf("-p") + 1], /JSON/);
});

test("reviewVideo rejects an empty SUCCESS runner envelope immediately", async (t) => {
  const dir = fakeAgy(t, "");
  const video = path.join(dir, "video.mp4");
  fs.writeFileSync(video, Buffer.alloc(10));
  let calls = 0;
  await assert.rejects(reviewVideo(video, {
    skipFacts: true,
    runner: async () => { calls++; return { status: "SUCCESS", response: "" }; },
  }), /empty response/i);
  assert.equal(calls, 1);
});

test("agy runner rejects empty SUCCESS from the executable", async (t) => {
  fakeAgy(t, `console.log(JSON.stringify({status: 'SUCCESS', response: ''}));`);
  await assert.rejects(defaultAgyRunner("Review", { timeoutSeconds: 5 }), /empty response/i);
});

test("agy timeout kills a SIGTERM-resistant process tree and removes parent hooks", { skip: process.platform === "win32" }, async (t) => {
  const dir = fakeAgy(t, stubbornTree);
  const exits = process.listenerCount("exit");
  const terms = process.listenerCount("SIGTERM");
  const result = defaultAgyRunner("Review", { timeoutSeconds: 0.5 });
  const guard = setTimeout(() => {
    for (const name of ["child.pid", "leader.pid"]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) process.kill(Number(fs.readFileSync(file, "utf8")), "SIGKILL");
    }
  }, 4000);
  try {
    await assert.rejects(result, /timed out/i);
    for (const name of ["leader.pid", "child.pid"]) {
      const pid = Number(fs.readFileSync(path.join(dir, name), "utf8"));
      await until(() => !alive(pid));
    }
    assert.equal(process.listenerCount("exit"), exits);
    assert.equal(process.listenerCount("SIGTERM"), terms);
  } finally {
    clearTimeout(guard);
  }
});

test("agy idle watchdog reaps a quiet tree when explicitly enabled", { skip: process.platform === "win32" }, async (t) => {
  const dir = fakeAgy(t, stubbornTree);
  const savedIdle = process.env.AIDEOS_AGY_IDLE_TIMEOUT;
  process.env.AIDEOS_AGY_IDLE_TIMEOUT = "0.3";
  t.after(() => {
    if (savedIdle === undefined) delete process.env.AIDEOS_AGY_IDLE_TIMEOUT;
    else process.env.AIDEOS_AGY_IDLE_TIMEOUT = savedIdle;
  });
  await assert.rejects(defaultAgyRunner("Review", { timeoutSeconds: 10 }), /appears wedged: no stdout or CPU growth/i);
  for (const name of ["leader.pid", "child.pid"]) {
    const pid = Number(fs.readFileSync(path.join(dir, name), "utf8"));
    await until(() => !alive(pid));
  }
});

test("agy runner lets a quiet model request continue by default", async (t) => {
  fakeAgy(t, `setTimeout(() => console.log(JSON.stringify({status: 'SUCCESS', response: '{"rating":8}'})), 1500);`);
  const savedIdle = process.env.AIDEOS_AGY_IDLE_TIMEOUT;
  delete process.env.AIDEOS_AGY_IDLE_TIMEOUT;
  t.after(() => {
    if (savedIdle !== undefined) process.env.AIDEOS_AGY_IDLE_TIMEOUT = savedIdle;
  });
  assert.equal(JSON.parse(await defaultAgyRunner("Review", { timeoutSeconds: 5 })).rating, 8);
});

for (const activity of ["stdout", "CPU"]) {
  test(`agy idle watchdog allows continuing ${activity} progress`, { skip: process.platform === "win32" }, async (t) => {
    const script = activity === "stdout"
      ? `const timer = setInterval(() => process.stdout.write(' '), 50); setTimeout(() => {clearInterval(timer); console.log(JSON.stringify({status: 'SUCCESS', response: '{"rating":8}'}));}, 2000);`
      : `const end = Date.now() + 2000; while (Date.now() < end) {} console.log(JSON.stringify({status: 'SUCCESS', response: '{"rating":8}'}));`;
    fakeAgy(t, script);
    const savedIdle = process.env.AIDEOS_AGY_IDLE_TIMEOUT;
    process.env.AIDEOS_AGY_IDLE_TIMEOUT = "1";
    t.after(() => {
      if (savedIdle === undefined) delete process.env.AIDEOS_AGY_IDLE_TIMEOUT;
      else process.env.AIDEOS_AGY_IDLE_TIMEOUT = savedIdle;
    });
    assert.equal(JSON.parse(await defaultAgyRunner("Review", { timeoutSeconds: 60 })).rating, 8);
  });
}

for (const termination of ["SIGTERM", "exit"]) {
  test(`review parent ${termination} kills its agy process group`, { skip: process.platform === "win32" }, async (t) => {
    const dir = fakeAgy(t, stubbornTree);
    const exitOnReady = termination === "exit" ? `const fs = require('node:fs'); setInterval(() => { if (fs.existsSync(${JSON.stringify(path.join(dir, "child.pid"))})) process.exit(0); }, 30);` : "";
    const parent = spawn(process.execPath, ["--import", "tsx", "-e", `require(${JSON.stringify(path.resolve("backend/geminiReview/geminiReview.ts"))}).defaultAgyRunner('Review', {timeoutSeconds: 60}); ${exitOnReady}`], { stdio: "ignore" });
    t.after(() => parent.kill("SIGKILL"));
    await until(() => fs.existsSync(path.join(dir, "child.pid")));
    if (termination === "SIGTERM") parent.kill("SIGTERM");
    for (const name of ["leader.pid", "child.pid"]) {
      const pid = Number(fs.readFileSync(path.join(dir, name), "utf8"));
      await until(() => !alive(pid));
    }
  });
}
