/**
 * File Description: Runtime access to process environment values and the Studio port resolver.
 * Inputs and outputs: Process environment entries -> live string or undefined values.
 * Used by: Node-side configuration, CLI and Studio server modules.
 */

import { z } from "zod";

const environmentValue = z.string().optional();
const studioPortValue = z.string().regex(/^[0-9]+$/).refine((value) => Number(value) <= 65535);

// Browser-bundled screenplay code has no Node process; its environment is intentionally empty.
const runtimeEnvironment: NodeJS.ProcessEnv = typeof process !== "undefined" && process.env ? process.env : {};

/** Reads each value lazily so runtime overrides remain visible without inspecting unrelated entries. */
export const environment: NodeJS.ProcessEnv = new Proxy(runtimeEnvironment, {
  // Writes directly to the native environment object, which rejects proxy receiver descriptors.
  set(target, property, value) {
    return Reflect.set(target, property, value, target);
  },
  // Validates only environment entries and preserves inherited object methods.
  get(target, property, receiver) {
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof property === "string" && (value === undefined || Object.prototype.hasOwnProperty.call(target, property))
      ? environmentValue.parse(value)
      : value;
  },
});

/** Resolves the Studio port from PORT, using the fallback when unset, empty or 0 and failing on malformed values. */
export function resolveStudioPort(fallback: number): number {
  const raw = environment.PORT;
  if (raw === undefined || raw === "") return fallback;
  if (!studioPortValue.safeParse(raw).success) {
    throw new Error(`Invalid PORT ${JSON.stringify(raw)}: expected a whole number from 0 to 65535.`);
  }
  return Number(raw) || fallback;
}
