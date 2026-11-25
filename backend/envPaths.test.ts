/**
 * File Description: Exercises live environment forwarding and shared repository paths.
 * Inputs and outputs: Generated environment values and isolated working directories -> verified runtime behavior.
 * Used by: npm test and targeted configuration verification.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";
import { environment } from "./env";
import { callerWorkingDirectory, REPO_ROOT } from "./paths";
import { forAll, randInt } from "./testSupport/propertyTest";

const key = "AIDEOS_ENV_PATHS_TEST_VALUE";

test("environment reflects live writes and forwards generated values to a child process", () => {
  const previous = process.env[key];
  try {
    forAll("live environment values", (rand) => {
      const alphabet = "aZ09 _-./=é";
      return Array.from({ length: randInt(rand, 0, 80) }, () => alphabet[randInt(rand, 0, alphabet.length - 1)]).join("");
    }, (value) => {
      process.env[key] = value;
      assert.equal(environment[key], value);
      assert.equal({ ...environment }[key], value);
    });
    environment[key] = "value passed to a child";
    const child = spawnSync(process.execPath, ["-e", `process.stdout.write(process.env.${key} || '')`], {
      env: environment,
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "value passed to a child");
    delete environment[key];
    assert.equal(process.env[key], undefined);
    assert.equal(typeof environment.hasOwnProperty, "function");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("Studio port accepts valid values and rejects malformed configuration", () => {
  const previous = process.env.PORT;
  try {
    for (const value of ["", "0", "3001", "65535"]) {
      process.env.PORT = value;
      assert.equal(environment.PORT, value);
    }
    for (const value of ["not-a-port", "-1", "65536"]) {
      process.env.PORT = value;
      assert.throws(() => environment.PORT, /PORT must be/);
    }
  } finally {
    if (previous === undefined) delete process.env.PORT;
    else process.env.PORT = previous;
  }
});

test("repository root stays fixed while caller directory follows the process", () => {
  const original = process.cwd();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-env-paths-"));
  try {
    process.chdir(temporary);
    assert.equal(callerWorkingDirectory(), temporary);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "package.json")));
    assert.equal(REPO_ROOT, path.resolve(__dirname, ".."));
  } finally {
    process.chdir(original);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("the screenplay editor runs in a browser without Node process globals", async () => {
  const bundle = await build({
    stdin: {
      contents: 'import { plainTextToTaggedScript } from "./backend/scriptIntake"; globalThis.convert = plainTextToTaggedScript;',
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  const sandbox: { convert?: (text: string) => string } = {};
  vm.createContext(sandbox);
  vm.runInContext(bundle.outputFiles[0].text, sandbox);
  assert.equal(typeof sandbox.convert, "function");
  assert.ok(sandbox.convert);
  assert.match(sandbox.convert("A small story."), /A small story/);
});
