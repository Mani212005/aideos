/**
 * File Description: The voice of choice. The owner's cloned voice (the local `vcd` service, Studio
 * keys vcd-my-voice and vcd-my-voice-hi) is the one narrator every film is made with. This module
 * names that rule once and reads a recorded narrator (the `ttsBackend` string a narration.json holds,
 * such as "vcd:voice_abc:auto", "kokoro:af_heart" or "aura-asteria-en") to say whether it is the voice
 * of choice. It stays pure (no Node imports) so the design check and any test can use it.
 * Inputs and outputs: a recorded ttsBackend string and an environment -> a narrator kind, a yes or no, or a design finding message.
 * Used by: backend/designCheck/designCheck.ts, backend/voiceOfChoice.test.ts.
 */

import { environment } from "./env";

/** The one speech backend that speaks with the owner's cloned voice. */
export const VOICE_OF_CHOICE_BACKEND = "vcd";

/** Environment switch that lets a run keep another narrator; only the captain may say to set it. */
export const OTHER_VOICE_OVERRIDE_ENV = "AIDEOS_ALLOW_OTHER_VOICE";

/** A design check message about a narrator that is not the voice of choice. */
export interface VoiceOfChoiceFinding {
  severity: "error" | "warning";
  message: string;
}

// Reads the narrator kind (the leading word) out of a recorded backend name or Studio voice key.
export function narratorKind(ttsBackend: unknown): string {
  if (typeof ttsBackend !== "string") return "";
  return ttsBackend.trim().toLowerCase().split(/[:|-]/)[0];
}

// True when a recorded narrator is the owner's cloned voice.
export function isVoiceOfChoiceNarrator(ttsBackend: unknown): boolean {
  return narratorKind(ttsBackend) === VOICE_OF_CHOICE_BACKEND;
}

// True when the environment explicitly lets this run keep a narrator other than the voice of choice.
export function otherVoiceOverrideActive(env: NodeJS.ProcessEnv = environment): boolean {
  const value = env[OTHER_VOICE_OVERRIDE_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

// Judges the narrator an existing narration.json recorded: null for the voice of choice, an error for any other or missing narrator, a warning when an override allows it.
export function voiceOfChoiceFinding(ttsBackend: unknown, allowOther: boolean): VoiceOfChoiceFinding | null {
  if (isVoiceOfChoiceNarrator(ttsBackend)) return null;
  const recorded = typeof ttsBackend === "string" ? ttsBackend.trim() : "";
  const spoken = recorded
    ? `narrated by "${recorded}", not the voice of choice (the owner's cloned voice, vcd)`
    : "records no narrator (ttsBackend is missing or not a string), so it is not shown to be the voice of choice (the owner's cloned voice, vcd)";
  if (allowOther) {
    return { severity: "warning", message: `${spoken}; kept because ${OTHER_VOICE_OVERRIDE_ENV} is set. Only the captain may allow another voice.` };
  }
  return {
    severity: "error",
    message: `${spoken}. Narrate it again with the default voice (start the voice service, see "Voice of choice" in docs/PRODUCTION_PIPELINE.md). Only the captain may allow another voice, by setting ${OTHER_VOICE_OVERRIDE_ENV}=1.`,
  };
}
