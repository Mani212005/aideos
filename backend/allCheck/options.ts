/**
 * File Description: Parses and validates the command line of `aideos all-check <slug>
 * [--reference <mp4>] [--rounds <n>] [--target <score>] [--agent claude|agy] [--model <id>] [--allow-forbidden-model]` into typed options,
 * failing with one clear line per mistake. Pure apart from the reference file existence check.
 */

import fs from "node:fs";
import path from "node:path";
import {
  AGENT_NAMES,
  AllCheckError,
  DEFAULT_ROUNDS,
  DEFAULT_TARGET,
  type AgentName,
  type AllCheckOptions,
} from "./types";

/** The flags exactly as commander hands them over. */
export interface RawAllCheckFlags {
  reference?: string;
  rounds?: string | number;
  target?: string | number;
  agent?: string;
  model?: string;
  allowForbiddenModel?: boolean;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// Reads a whole number from a flag, rejecting fractions, text and out-of-range values.
function parseRounds(value: string | number | undefined): number {
  if (value === undefined || value === "") return DEFAULT_ROUNDS;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 30) {
    throw new AllCheckError(`--rounds must be a whole number from 1 to 30 (got "${value}")`);
  }
  return n;
}

// Reads the score bar from a flag: a number from 1 to 10.
function parseTarget(value: string | number | undefined): number {
  if (value === undefined || value === "") return DEFAULT_TARGET;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 10) {
    throw new AllCheckError(`--target must be a score from 1 to 10 (got "${value}")`);
  }
  return n;
}

// Maps an agent name or alias to the supported background agent, or returns undefined for unset.
export function normalizeAgent(value: string | undefined): AgentName | undefined {
  if (value === undefined || value === "") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "antigravity") return "agy";
  if ((AGENT_NAMES as readonly string[]).includes(v)) return v as AgentName;
  throw new AllCheckError(`--agent must be one of ${AGENT_NAMES.join(", ")} (got "${value}")`);
}

// Turns the slug argument and flags into validated options.
export function parseAllCheckOptions(slug: string, flags: RawAllCheckFlags = {}): AllCheckOptions {
  if (!SLUG.test(slug ?? "")) {
    throw new AllCheckError(`"${slug}" is not a film slug: use lowercase letters, digits and dashes (the folder name under videos/)`);
  }
  let reference: string | undefined;
  if (flags.reference) {
    reference = path.resolve(flags.reference);
    if (!/\.(mp4|mov|webm|mkv)$/i.test(reference) || !fs.existsSync(reference) || !fs.statSync(reference).isFile()) {
      throw new AllCheckError(`--reference must be an existing video file (got "${flags.reference}")`);
    }
  }
  return {
    slug,
    reference,
    rounds: parseRounds(flags.rounds),
    target: parseTarget(flags.target),
    agent: normalizeAgent(flags.agent),
    model: flags.model?.trim() || undefined,
    allowForbiddenModel: flags.allowForbiddenModel === true,
  };
}
