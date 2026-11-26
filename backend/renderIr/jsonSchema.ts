/**
 * File Description: Produces the JSON Schemas (draft 2020-12) of every Render IR version (`/1`, `/2`, `/3`, `/5`) from the zod schemas in schema.ts, and knows where the committed copies live. The committed copies are what the Rust loader embeds, so the two languages validate documents against one schema per version.
 * Inputs and outputs: the zod schemas -> JSON Schema objects and their canonical serialized text.
 * Used by: scripts/render_ir_schema.ts, backend/renderIr/renderIr.test.ts.
 */

import path from "node:path";
import { z } from "zod";
import { renderIrSchema, renderIrSchemaV2, renderIrSchemaV3, renderIrSchemaV5 } from "./schema";

/** The committed `/1` schema file, shared with the Rust crate. */
export const RENDER_IR_SCHEMA_PATH = path.resolve(__dirname, "../../native/aideos-render-ir/schema/aideos.render.1.schema.json");
/** The committed `/2` schema file, shared with the Rust crate. */
export const RENDER_IR_SCHEMA_V2_PATH = path.resolve(__dirname, "../../native/aideos-render-ir/schema/aideos.render.2.schema.json");

/** The committed `/3` schema file, shared with the Rust crate. */
export const RENDER_IR_SCHEMA_V3_PATH = path.resolve(__dirname, "../../native/aideos-render-ir/schema/aideos.render.3.schema.json");

/** Builds the JSON Schema of the `/1` Render IR from the zod source of truth. */
export function renderIrJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(renderIrSchema, { target: "draft-2020-12", io: "input", unrepresentable: "throw" }) as Record<string, unknown>;
  return {
    ...schema,
    $id: "urn:aideos:schema:render:1",
    title: "aideos.render/1 (Render IR)",
  };
}

/** Builds the JSON Schema of the `/2` Render IR from the zod source of truth. */
export function renderIrJsonSchemaV2(): Record<string, unknown> {
  const schema = z.toJSONSchema(renderIrSchemaV2, { target: "draft-2020-12", io: "input", unrepresentable: "throw" }) as Record<string, unknown>;
  return {
    ...schema,
    $id: "urn:aideos:schema:render:2",
    title: "aideos.render/2 (Render IR)",
  };
}

/** The canonical text of the `/1` schema file: two-space JSON with a trailing newline. */
export function renderIrJsonSchemaText(): string {
  return `${JSON.stringify(renderIrJsonSchema(), null, 2)}\n`;
}

/** The canonical text of the `/2` schema file: two-space JSON with a trailing newline. */
export function renderIrJsonSchemaV2Text(): string {
  return `${JSON.stringify(renderIrJsonSchemaV2(), null, 2)}\n`;
}

/** Builds the JSON Schema of the `/3` Render IR from the zod source of truth. */
export function renderIrJsonSchemaV3(): Record<string, unknown> {
  const schema = z.toJSONSchema(renderIrSchemaV3, { target: "draft-2020-12", io: "input", unrepresentable: "throw" }) as Record<string, unknown>;
  return {
    ...schema,
    $id: "urn:aideos:schema:render:3",
    title: "aideos.render/3 (Render IR)",
  };
}

/** The canonical text of the `/3` schema file: two-space JSON with a trailing newline. */
export function renderIrJsonSchemaV3Text(): string {
  return `${JSON.stringify(renderIrJsonSchemaV3(), null, 2)}\n`;
}

/** The committed `/5` schema file, shared with the Rust crate. */
export const RENDER_IR_SCHEMA_V5_PATH = path.resolve(__dirname, "../../native/aideos-render-ir/schema/aideos.render.5.schema.json");

/** Builds the JSON Schema of the `/5` Render IR from the zod source of truth. */
export function renderIrJsonSchemaV5(): Record<string, unknown> {
  const schema = z.toJSONSchema(renderIrSchemaV5, { target: "draft-2020-12", io: "input", unrepresentable: "throw" }) as Record<string, unknown>;
  return {
    ...schema,
    $id: "urn:aideos:schema:render:5",
    title: "aideos.render/5 (Render IR)",
  };
}

/** The canonical text of the `/5` schema file: two-space JSON with a trailing newline. */
export function renderIrJsonSchemaV5Text(): string {
  return `${JSON.stringify(renderIrJsonSchemaV5(), null, 2)}\n`;
}
