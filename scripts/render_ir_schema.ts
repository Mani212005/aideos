/**
 * File Description: Writes (or with --check verifies) the committed JSON Schema of the Render IR, so the Rust loader's embedded schema is always the one the zod source describes.
 * Inputs and outputs: optional --check flag -> rewrites native/aideos-render-ir/schema/aideos.render.1.schema.json, or exits 1 when it is out of date.
 * Used by: npm run render-ir:schema, backend/renderIr/renderIr.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { RENDER_IR_SCHEMA_PATH, renderIrJsonSchemaText } from "../backend/renderIr/jsonSchema";

// Writes the schema file, or compares it when asked to check.
function main(): void {
  const wanted = renderIrJsonSchemaText();
  if (process.argv.includes("--check")) {
    const have = fs.existsSync(RENDER_IR_SCHEMA_PATH) ? fs.readFileSync(RENDER_IR_SCHEMA_PATH, "utf8") : "";
    if (have !== wanted) {
      console.error("Render IR JSON Schema is out of date: run `npm run render-ir:schema`.");
      process.exit(1);
    }
    return;
  }
  fs.mkdirSync(path.dirname(RENDER_IR_SCHEMA_PATH), { recursive: true });
  fs.writeFileSync(RENDER_IR_SCHEMA_PATH, wanted);
  console.log(`wrote ${path.relative(process.cwd(), RENDER_IR_SCHEMA_PATH)}`);
}

main();
