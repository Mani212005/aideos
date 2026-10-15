/**
 * File Description: ESLint flat configuration. Remotion's preset applies to the video code in src; backend, scripts and the editor get the same base rules with Node or browser globals and without the Remotion-only rules.
 * Inputs and outputs: Remotion flat ESLint config -> exported ESLint configuration array covering src, backend, scripts and editor/src.
 * Used by: npm run lint, npm run ci (static job).
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
  "backend/agentBridge/{contextBuilder,dispatcher,taskQueue,traceBus,types}.ts",
  "backend/cli.ts",
  "backend/critique/engine.ts",
  "backend/editPlanner/{interpreter,validator}.ts",
  "backend/geminiReview/{geminiReview,types}.ts",
  "backend/goodVideoRubric.ts",
  "backend/ideation/{segmentSync,visualSelector}.ts",
  "backend/mcp/server.ts",
  "backend/timeline/{layer_manager,snap,updates}.ts",
  "scripts/smoke_studio.ts",
  "scripts/validate_film.ts",
  "editor/src/components/{AgentActivityInspector,CritiqueStudio,CustomizationEditor,OnCanvasAiEditor,ScriptEditor,ShotInspector,ShotModal,Styleboard}.tsx",
  "editor/src/state/useFilmProject.ts",
];

export default [
  ...remotionConfig,
  {
    ignores: ["editor/dist/**", ".frames/**", "videos/**", "public/**", "src/dl/films/**"],
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
    files: ["backend/**", "scripts/**", "bin/**", "*.mjs", "*.config.*"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["editor/src/**"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Remotion's rules police animation purity inside compositions; they mean nothing in Node tooling or editor chrome.
    files: ["backend/**", "scripts/**", "bin/**", "editor/**", "*.mjs"],
    rules: Object.fromEntries(remotionRules.map((name) => [name, "off"])),
  },
  {
    files: LEGACY_ANY,
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
