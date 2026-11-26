/**
 * File Description: Writes (or with --check verifies) the committed JSON Schemas of every Render IR version, so the Rust loader's embedded schemas are always the ones the zod source describes.
 * Inputs and outputs: optional --check flag -> rewrites native/aideos-render-ir/schema/aideos.render.{1,2,3,5}.schema.json, or exits 1 when any is out of date.
 * Used by: npm run render-ir:schema, backend/renderIr/renderIr.test.ts.
 */

import { callerWorkingDirectory } from "../backend/paths";

import fs from "node:fs";
import path from "node:path";
import { RENDER_IR_SCHEMA_PATH, RENDER_IR_SCHEMA_V2_PATH, RENDER_IR_SCHEMA_V3_PATH, RENDER_IR_SCHEMA_V5_PATH, renderIrJsonSchemaText, renderIrJsonSchemaV2Text, renderIrJsonSchemaV3Text, renderIrJsonSchemaV5Text } from "../backend/renderIr/jsonSchema";

// Writes each schema file, or compares them when asked to check.
function main(): void {
  const files: Array<[string, string]> = [[RENDER_IR_SCHEMA_PATH, renderIrJsonSchemaText()], [RENDER_IR_SCHEMA_V2_PATH, renderIrJsonSchemaV2Text()], [RENDER_IR_SCHEMA_V3_PATH, renderIrJsonSchemaV3Text()], [RENDER_IR_SCHEMA_V5_PATH, renderIrJsonSchemaV5Text()]];
  if (process.argv.includes("--check")) {
    const stale = files.filter(([file, wanted]) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "") !== wanted);
    if (stale.length) {
      console.error(`Render IR JSON Schema is out of date (${stale.map(([f]) => path.basename(f)).join(", ")}): run \`npm run render-ir:schema\`.`);
      process.exit(1);
    }
    return;
  }
  for (const [file, wanted] of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, wanted);
    console.log(`wrote ${path.relative(callerWorkingDirectory(), file)}`);
  }
}

main();
