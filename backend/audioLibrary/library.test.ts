/**
 * File Description: Tests that `aideos audio fetch` survives a broken item and still fetches the rest of the library.
 * Inputs and outputs: a local loopback HTTP server and a synthetic manifest -> fetch reports and cached files.
 * Used by: npm test (backend/**\/*.test.ts glob).
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fetchAudioLibrary } from "./library";
import { parseAudioLibrary, type AudioLibrary } from "./schema";

const GOOD_BYTES = Buffer.from("not really audio but stable bytes");

// Serves a valid file only when the request carries a same-origin Referer, and an HTML page otherwise (the kenney.nl behaviour).
function startServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    if (req.url === "/good.mp3" && req.headers.referer === origin) {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(GOOD_BYTES);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>not the file</html>");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Builds a manifest item that downloads from the loopback server.
function item(id: string, url: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "sfx",
    title: id,
    artist: "test",
    source: "test",
    url,
    licence: { id: "cc0-1.0", url: "https://example.com/licence", attribution: null, checkedAt: "2026-11-21" },
    sha256: crypto.createHash("sha256").update(GOOD_BYTES).digest("hex"),
    bytes: GOOD_BYTES.length,
    durationSec: 1,
    loudness: { integratedLufs: -20, truePeakDb: -3, lra: 0 },
    roles: ["ui"],
    moods: ["test"],
    energy: 1,
    contentIdRisk: "none",
    ...extra,
  };
}

// Starts the server, a temp cache and a manifest of the given items; cleans both up after the test.
async function setup(t: test.TestContext, items: (base: string) => unknown[]) {
  const server = await startServer();
  t.after(
    () =>
      new Promise<void>((resolve) => {
        // fetch keeps connections alive; close them so the server can shut down.
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-audio-fetch-"));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const library: AudioLibrary = parseAudioLibrary({
    schema: "aideos.audio-library/1",
    version: 1,
    items: items(base),
  });
  return { base, cacheDir, library };
}

test("audio fetch continues past a broken item and exits not-ok only for a required failure", async (t) => {
  const { cacheDir, library } = await setup(t, (base) => [
    item("broken-archive", `${base}/missing.zip`, { archivePath: "Audio/x.ogg" }),
    item("good-after", `${base}/good.mp3`),
  ]);

  const report = await fetchAudioLibrary(library, { cacheDir });

  assert.deepEqual(
    report.results.map((r) => [r.id, r.status]),
    [
      ["broken-archive", "failed"],
      ["good-after", "downloaded"],
    ],
  );
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.requiredFailed, 1);
  assert.equal(report.ok, false);
  assert.ok(fs.existsSync(path.join(cacheDir, "good-after.mp3")));
});

test("audio fetch is ok when only an item marked required:false fails", async (t) => {
  const { cacheDir, library } = await setup(t, (base) => [
    item("optional-broken", `${base}/missing.mp3`, { required: false }),
    item("good-after", `${base}/good.mp3`),
  ]);

  const report = await fetchAudioLibrary(library, { cacheDir });

  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.requiredFailed, 0);
  assert.equal(report.ok, true);
  assert.ok(fs.existsSync(path.join(cacheDir, "good-after.mp3")));
});
