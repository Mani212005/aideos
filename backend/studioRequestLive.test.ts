/**
 * File Description: End-to-end tests of the live Studio server against hostile ids and oversized bodies: an id that is not lowercase letters, digits and dashes never reaches the disk, and a body past its route's cap is refused with 413 before it is read.
 * Inputs and outputs: raw HTTP requests to a real Studio dev server on a throwaway videos folder -> assertions on status codes and on the folder staying untouched.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startEditor } from "./testSupport/studioDriver";
import { DEFAULT_BODY_LIMIT_BYTES, UPLOAD_BODY_LIMIT_BYTES } from "./studioRequest";

// Sends a POST that only announces `declaredBytes` of body and then sends a few bytes, so the server has to decide from the header alone.
function postAnnouncing(baseUrl: string, route: string, declaredBytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/json", origin: url.origin, "content-length": declaredBytes } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
        req.destroy();
      },
    );
    req.on("error", (error) => (error as NodeJS.ErrnoException).code === "ECONNRESET" ? undefined : reject(error));
    req.write("{");
  });
}

test("Live Studio server refuses unsafe ids and oversized bodies before touching disk", async () => {
  const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-request-e2e-"));
  const outside = path.join(path.dirname(videosDir), `outside-${path.basename(videosDir)}`);
  fs.mkdirSync(path.join(outside, "footage"), { recursive: true });
  fs.writeFileSync(path.join(outside, "footage", "leaked.mp4"), "x");
  const server = await startEditor(videosDir);
  const origin = new URL(server.url).origin;
  const post = (route: string, body: unknown) =>
    fetch(new URL(route, server.url), { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

  try {
    // A film id that climbs out of the videos folder must not list or reach a footage folder elsewhere.
    const climb = `../${path.basename(outside)}`;
    const status = await fetch(new URL(`/api/broll/status?filmId=${encodeURIComponent(climb)}`, server.url));
    assert.equal(status.status, 400);
    assert.equal(JSON.stringify(await status.json()).includes("leaked"), false);
    assert.equal((await fetch(new URL("/api/broll/status?filmId=a-film", server.url))).status, 200);
    assert.equal((await fetch(new URL("/api/broll/status", server.url))).status, 400);

    assert.equal((await post("/api/broll/generate", { filmId: climb, shotId: "beat-01" })).status, 400);
    assert.equal((await post("/api/broll/generate", { filmId: "a-film", shotId: "../beat" })).status, 400);
    assert.equal((await post("/api/ai-edit", { film: { id: climb, fps: 30, shots: [] }, request: "trim" })).status, 400);
    assert.equal((await post("/api/media/upload", { filename: "..", base64Data: "aGk=" })).status, 400);

    // A body that announces more than its route accepts is refused on the header; uploads get the larger cap.
    assert.equal(await postAnnouncing(server.url, "/api/scripts/a-film", DEFAULT_BODY_LIMIT_BYTES + 1), 413);
    assert.equal(await postAnnouncing(server.url, "/api/media/upload", UPLOAD_BODY_LIMIT_BYTES + 1), 413);

    // A file outside the videos folder is never served, whether the path climbs with a plain, an encoded or a broken escape.
    fs.writeFileSync(path.join(outside, "secret.txt"), "OUTSIDE-SECRET");
    const sibling = path.basename(outside);
    for (const route of [`/videos/../${sibling}/secret.txt`, `/videos/%2e%2e/${sibling}/secret.txt`, `/videos/..%2F${sibling}%2Fsecret.txt`, "/videos/%E0%A4%A", "/api/downloads/%E0%A4%A"]) {
      const res = await fetch(new URL(route, server.url));
      assert.equal((await res.text()).includes("OUTSIDE-SECRET"), false, route);
      assert.notEqual(res.status, 500, route);
    }
    fs.mkdirSync(path.join(videosDir, "a-film"));
    fs.writeFileSync(path.join(videosDir, "a-film", "note.txt"), "INSIDE-OK");
    const inside = await fetch(new URL("/videos/a-film/note.txt", server.url));
    assert.equal(inside.status, 200);
    assert.equal(await inside.text(), "INSIDE-OK");
    const ranged = await fetch(new URL("/videos/a-film/note.txt", server.url), { headers: { range: "bytes=0-5" } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "INSIDE");
    fs.rmSync(path.join(videosDir, "a-film"), { recursive: true, force: true });

    assert.deepEqual(fs.readdirSync(videosDir), [], "no refused request may create anything in the videos folder");
  } finally {
    server.stop();
    fs.rmSync(videosDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
