/**
 * File Description: Expect test of the Render IR emitter: the full document emitted for the synthetic scene film, long and reel, is compared with the committed output in test_fixtures/expect/render-ir/. The files were captured from the real emitter and are reviewed by diff when the IR changes on purpose. This catches any change to a track, keyframe, node, asset or font the field-level tests in emit.test.ts do not name. Each committed file must also still pass the IR validator, and emitting twice must give the same bytes.
 * Inputs and outputs: backend/testSupport/nativeSceneFilm.ts with the fake measurer -> equality with test_fixtures/expect/render-ir/native-probe.{long,reel}.json.
 * Used by: npm test (found by glob), the CI unit job.
 */

import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import test from "node:test";
import { expectFile, formatForReview } from "../testSupport/expectFile";
import { fakeMeasurer, nativeSceneFilm, NATIVE_SVG_SOURCES } from "../testSupport/nativeSceneFilm";
import { emitRenderIr, type NativeFormat } from "./emit";
import { validateRenderIr } from "./validate";

// Emits one format of the synthetic film with the fake measurer and repo-rooted path resolution.
function emit(format: NativeFormat) {
  return emitRenderIr({ film: nativeSceneFilm(), format, svgSources: NATIVE_SVG_SOURCES, measure: fakeMeasurer(), resolvePath: (p) => `/repo/${p}` }).ir;
}

for (const format of ["long", "reel"] as const) {
  test(`the ${format} Render IR of the synthetic scene film matches the reviewed expected output`, () => {
    const ir = emit(format);
    const text = formatForReview(ir);
    assert.equal(text, formatForReview(emit(format)), "emitting the same film twice must give identical output");
    assert.ok(validateRenderIr(ir).ok, "the emitted document validates");
    expectFile(text, `render-ir/native-probe.${format}.json`);
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(ir)), "the reviewed text is the same document as the emitted one");
  });
}
