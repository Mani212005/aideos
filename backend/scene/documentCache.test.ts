/**
 * File Description: Tests bounded scene SVG document caching and least-recently-used eviction.
 * Inputs and outputs: SVG source access sequences -> cache behavior assertions.
 * Used by: Node test runner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocumentCache } from "../../src/dl/scene/documentCache";
import { parseSvgDocument } from "../../src/dl/scene/svgDocument";

test("cache retains recent and invalid sources and evicts the least recently used", () => {
  const calls: string[] = [];
  const get = createDocumentCache((source) => {
    calls.push(source);
    try { return parseSvgDocument(source); } catch { return null; }
  }, 2);
  const a = '<svg><rect id="a" /></svg>';
  const b = '<svg><rect id="b" /></svg>';
  const c = '<svg><rect id="c" /></svg>';
  const first = get(a);
  get(b);
  assert.strictEqual(get(a), first);
  get(c);
  get(a);
  get(b);
  assert.deepEqual(calls, [a, b, c, b]);
  assert.equal(get("bad"), null);
  assert.equal(get("bad"), null);
  assert.equal(calls.filter((source) => source === "bad").length, 1);
  assert.throws(() => createDocumentCache(() => null, 0));
});

test("generated distinct sources retain only the most recent capacity entries", () => {
  for (let capacity = 1; capacity <= 16; capacity++) {
    const calls: string[] = [];
    const get = createDocumentCache((source) => {
      calls.push(source);
      return null;
    }, capacity);
    const sources = Array.from({ length: capacity * 3 }, (_, index) => `source-${capacity}-${index}`);
    sources.forEach(get);
    for (const source of sources.slice(-capacity).reverse()) get(source);
    assert.equal(calls.length, sources.length);
    get(sources[0]);
    assert.equal(calls.length, sources.length + 1);
  }
});
