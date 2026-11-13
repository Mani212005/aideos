/**
 * File Description: Produces the JSON Schema (draft 2020-12) of the Render IR from the zod schema in schema.ts, and knows where the committed copy lives. The committed copy is what the Rust loader embeds, so the two languages validate documents against one schema.
 * Inputs and outputs: the zod schema -> a JSON Schema object and its canonical serialized text.
 * Used by: scripts/render_ir_schema.ts, backend/renderIr/renderIr.test.ts.
 */

import path from "node:path";
import { z } from "zod";
import { renderIrSchema } from "./schema";

/** The committed schema file, shared with the Rust crate. */
export const RENDER_IR_SCHEMA_PATH = path.resolve(__dirname, "../../native/aideos-render-ir/schema/aideos.render.1.schema.json");

/** Builds the JSON Schema of the Render IR from the zod source of truth. */
export function renderIrJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(renderIrSchema, { target: "draft-2020-12", io: "input", unrepresentable: "throw" }) as Record<string, unknown>;
  return {
    ...schema,
    $id: "urn:aideos:schema:render:1",
    title: "aideos.render/1 (Render IR)",
  };
}

/** The canonical text of the schema file: two-space JSON with a trailing newline. */
export function renderIrJsonSchemaText(): string {
  return `${JSON.stringify(renderIrJsonSchema(), null, 2)}\n`;
}
