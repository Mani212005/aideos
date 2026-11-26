/**
 * File Description: ESLint flat configuration. Remotion's preset applies to the video code in src; backend, scripts, bin, root *.mjs/*.config.*, editor/src, editor/vite.config.ts and test_fixtures/stillTalking get the same base rules with Node or browser globals and without the Remotion-only rules. `npm run lint` runs the CI static job, so it checks exactly what CI checks.
 * Inputs and outputs: Remotion flat ESLint config -> exported ESLint configuration array for passed repository paths.
 * Used by: npm run lint and npm run ci (static job: src, backend, scripts, editor/src, editor/vite.config.ts, test_fixtures/stillTalking).
 */

import { config as remotionConfig } from "@remotion/eslint-config-flat";
import globals from "globals";

/** Names of every Remotion-only rule the preset turns on (they assume a Remotion composition). */
const remotionRules = remotionConfig
  .flatMap((entry) => Object.keys(entry.rules ?? {}))
  .filter((name) => name.startsWith("@remotion/"));

/**
 * Files that still use `any`, kept as a shrink-only ledger (the same convention as KNOWN_DRIFT in
 * backend/design_language_palette.test.ts). Test files stub loosely typed module surfaces; the
 * production files below predate the rule. Fix the `any` and delete the entry when you touch one;
 * never add a file here, type the new code instead.
 */
const LEGACY_ANY = [
  "backend/**/*.test.ts",
  // Existing test-code exemptions follow the D7 moves; no new code is exempted.
  "backend/journeys/characters.journey.ts",
  "backend/live/audio.live.ts",
  "backend/agentBridge/{contextBuilder,dispatcher,taskQueue,traceBus,types}.ts",
  "backend/cli.ts",
  "backend/editPlanner/interpreter.ts",
  "backend/geminiReview/types.ts",
  "backend/ideation/{segmentSync,visualSelector}.ts",
  "backend/mcp/server.ts",
  "backend/timeline/{layer_manager,snap,updates}.ts",
  "editor/src/components/ScriptEditor.tsx",
  // The Studio dev server predates the rule (26 `any` in 2400 lines); type them as its routes move to backend/server/routes.
  "editor/vite.config.ts",
];

export default [
  ...remotionConfig,
  {
    ignores: ["editor/dist/**", ".frames/**", "videos/**", "public/**", "src/dl/films/**", "scripts/local/**"],
  },
  {
    // A best-effort cleanup (a temp file that is already gone, a probe that may fail) is a normal empty catch.
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    // A leading underscore marks a deliberately unused binding, the same convention tsc's noUnusedLocals honours.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["backend/**", "scripts/**", "bin/**", "*.mjs", "*.config.*", "editor/vite.config.ts", "test_fixtures/stillTalking/**"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["editor/src/**"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Remotion's rules police animation purity inside compositions; they mean nothing in Node tooling or editor chrome.
    files: ["backend/**", "scripts/**", "bin/**", "editor/**", "*.mjs", "test_fixtures/stillTalking/**"],
    rules: Object.fromEntries(remotionRules.map((name) => [name, "off"])),
  },
  {
    // Runtime environment and caller directory access belong to their shared Node modules.
    // Standalone .mjs entry points run without a TypeScript loader; tests control process state directly.
    files: ["backend/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "editor/**/*.{ts,tsx}"],
    ignores: ["backend/env.ts", "backend/paths.ts", "**/*.test.ts", "**/*.journey.ts", "**/*.golden.ts", "**/*.live.ts", "backend/testSupport/**", "backend/journeys/**"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "MemberExpression[object.name='process'][property.name='env']", message: "Use environment from backend/env.ts." },
        { selector: "MemberExpression[object.name='process'][property.value='env']", message: "Use environment from backend/env.ts." },
        { selector: "CallExpression[callee.object.name='process'][callee.property.name='cwd']", message: "Use callerWorkingDirectory from backend/paths.ts." },
        { selector: "CallExpression[callee.object.name='process'][callee.property.value='cwd']", message: "Use callerWorkingDirectory from backend/paths.ts." },
      ],
    },
  },
  {
    // Browser film code cannot depend on Node tools or test-only sources.
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["**/backend/**", "**/scripts/**", "**/test_fixtures/**"], message: "Keep browser film code independent of Node and test layers." }] }] },
  },
  {
    // Production backend modules cannot depend on scripts or fixture data.
    files: ["backend/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.journey.ts", "**/*.golden.ts", "**/*.live.ts", "backend/testSupport/**", "backend/journeys/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["**/scripts/**", "**/test_fixtures/**"], message: "Keep production backend code independent of scripts and fixtures." }] }] },
  },
  {
    files: LEGACY_ANY,
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
