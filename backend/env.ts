/**
 * File Description: Runtime access to validated process environment values.
 * Inputs and outputs: Process environment entries -> live string or undefined values.
 * Used by: Node-side configuration, CLI and Studio server modules.
 */

import { z } from "zod";

const environmentValue = z.string().optional();
const knownEnvironment = z.object({
  PORT: z.string().regex(/^(?:|[0-9]+)$/, "PORT must be a decimal port number")
    .refine((value) => value === "" || Number(value) <= 65535, "PORT must be at most 65535")
    .optional(),
});

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
      ? (property === "PORT" ? knownEnvironment.shape.PORT : environmentValue).parse(value)
      : value;
  },
});
