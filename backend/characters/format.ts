/**
 * File Description: Writes character spec JSON in the library's readable layout (numeric tuples on one line).
 * Inputs and outputs: authored spec object (optionally a new hash) -> formatted JSON text with the hash after the version.
 * Used by: `aideos character check --stamp` and the character tests that author fixture specs.
 */

// Formats a JSON value with numeric and string tuples collapsed onto single lines.
export function formatSpecJson(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    const flat = value.every((v) => typeof v !== "object" || v === null || (Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null)));
    if (flat) return `[${value.map((v) => JSON.stringify(v).replace(/,(?=\S)/g, ", ")).join(", ")}]`;
    return `[\n${value.map((v) => `${indent}  ${formatSpecJson(v, `${indent}  `)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${formatSpecJson(v, `${indent}  `)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

// Places the hash right after schema, id and version so a reader sees identity first.
export function withHash(raw: Record<string, unknown>, hash: string): Record<string, unknown> {
  const { schema, id, version, hash: _old, ...rest } = raw;
  void _old;
  return { schema, id, version, hash, ...rest };
}
