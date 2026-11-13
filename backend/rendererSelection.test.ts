/**
 * File Description: Behavioural tests of the renderer flag: Remotion is the default, `--renderer` and AIDEOS_RENDERER ask for native (the argument wins and is removed from the arguments passed on), an unknown name is refused, and asking for native falls back to Remotion, with every reason, when the film or the machine cannot render natively.
 * Inputs and outputs: argument lists, environments, the synthetic scene film and fake renderer factories -> asserted choices and reasons.
 * Used by: npm test (Node test runner).
 */

import "./testSupport/fixtureVideosDir";
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestedRenderer, selectRenderer } from "./rendererSelection";
import type { Renderer } from "./renderJob";
import { nativeSceneFilm } from "./testSupport/nativeSceneFilm";

/** A do-nothing renderer tagged with a name, plus a log of which factories ran. */
function factories() {
  const made: string[] = [];
  const make = (name: string) => () => {
    made.push(name);
    return { checkDiskBudget: async () => {}, render: async () => {}, name } as Renderer & { name: string };
  };
  return { made, remotion: make("remotion"), native: make("native") };
}

test("Remotion is the default and the flag or environment asks for native", () => {
  assert.deepEqual(requestedRenderer([], {}), { name: "remotion", rest: [] });
  assert.equal(requestedRenderer([], { AIDEOS_RENDERER: "native" }).name, "native");
  assert.deepEqual(requestedRenderer(["--concurrency=2", "--renderer", "native", "--log=verbose"], { AIDEOS_RENDERER: "remotion" }), {
    name: "native",
    rest: ["--concurrency=2", "--log=verbose"],
  });
  assert.equal(requestedRenderer(["--renderer=remotion"], { AIDEOS_RENDERER: "native" }).name, "remotion", "the argument wins over the environment");
  assert.throws(() => requestedRenderer(["--renderer", "chrome"], {}), /Unknown renderer "chrome"/);
  assert.throws(() => requestedRenderer(["--renderer"], {}), /needs a value/);
});

test("native is used when the film is supported and the binary is built", () => {
  const f = factories();
  const choice = selectRenderer(nativeSceneFilm(), "reel", "native", f, { binaryProblem: () => null });
  assert.equal(choice.name, "native");
  assert.equal(choice.fallbackReason, undefined);
  assert.deepEqual(f.made, ["native"]);
});

test("asking for native falls back to Remotion with every reason it cannot be used", () => {
  const f = factories();
  const film = nativeSceneFilm({ music: { src: "videos/native-probe/music.mp3", volume: 1 } });
  const choice = selectRenderer(film, "long", "native", f, { binaryProblem: () => "the native renderer binary is not built" });
  assert.equal(choice.name, "remotion");
  assert.match(choice.fallbackReason ?? "", /legacy music/);
  assert.match(choice.fallbackReason ?? "", /binary is not built/);
  assert.deepEqual(f.made, ["remotion"], "the native renderer is never constructed");
  const plain = factories();
  assert.equal(selectRenderer(film, "long", "remotion", plain, { binaryProblem: () => null }).name, "remotion");
  assert.deepEqual(plain.made, ["remotion"]);
});
