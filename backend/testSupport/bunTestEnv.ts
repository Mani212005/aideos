/**
 * File Description: First preload of every `bun test` file process started by scripts/bunTest.ts. It gives the
 * process the environment `node --test` gives each test file, so code that asks "am I under test" answers the same
 * on both toolchains: NODE_TEST_CONTEXT is set (production code reads it to keep agents, the vision judge, tmux and
 * the Jev device caller off), and NODE_ENV is put back to the runner's own value (bun test forces "test", Node
 * leaves it alone, and child renders and dev servers inherit it).
 * Inputs and outputs: AIDEOS_BUN_TEST_RUNNER and AIDEOS_BUN_TEST_NODE_ENV from scripts/bunTest.ts -> NODE_TEST_CONTEXT
 * and NODE_ENV of this test process (and of every child it spawns); the two marker variables are removed.
 * Used by: scripts/bunTest.ts (`bun test --preload`), before backend/testSupport/fixtureVideosDir.ts.
 */

// Loaded first on purpose: bun's node:test decides once, when it loads, whether to stream its events to a parent
// runner, and it does so whenever NODE_TEST_CONTEXT is set. Loading it before the variable is set keeps bun's own
// reporter (and its JUnit file) in charge, while the code under test still sees NODE_TEST_CONTEXT.
import "node:test";

/** The value `node --test` sets in every test file process it starts. */
const NODE_TEST_CHILD_CONTEXT = "child-v8";

/** Mirrors the per-file environment of `node --test`; does nothing outside the bun test runner. */
function mirrorNodeTestEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.AIDEOS_BUN_TEST_RUNNER !== "1") return;
  env.NODE_TEST_CONTEXT = NODE_TEST_CHILD_CONTEXT;
  if (env.AIDEOS_BUN_TEST_NODE_ENV === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = env.AIDEOS_BUN_TEST_NODE_ENV;
  delete env.AIDEOS_BUN_TEST_RUNNER;
  delete env.AIDEOS_BUN_TEST_NODE_ENV;
}

mirrorNodeTestEnvironment(process.env);
