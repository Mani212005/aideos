/**
 * File Description: The voice of choice. The owner's cloned voice (the local `vcd` service, Studio
 * keys vcd-my-voice and vcd-my-voice-hi) is the one narrator every film is made with. This module
 * names that rule once and reads a recorded narrator (the `ttsBackend` string a narration.json holds,
 * such as "vcd:voice_abc:auto", "kokoro:af_heart" or "aura-asteria-en") to say whether it is the voice
 * of choice. It stays pure (no Node imports) so the design check and any test can use it.
 * Inputs and outputs: a recorded ttsBackend string and an environment -> a narrator kind, a yes or no, or a design finding message.
 * Used by: backend/designCheck/designCheck.ts, backend/voiceOfChoice.test.ts.
 */

import { VCD_DEFAULT_VOICE_KEY, VCD_HINDI_VOICE_KEY } from "./vcdClient";

/** The one speech backend that speaks with the owner's cloned voice. */
export const VOICE_OF_CHOICE_BACKEND = "vcd";

/** Studio voice keys that select the voice of choice (English and Hindi or Hinglish). */
export const VOICE_OF_CHOICE_STUDIO_KEYS: readonly string[] = [VCD_DEFAULT_VOICE_KEY, VCD_HINDI_VOICE_KEY];

/** Environment switch that lets a run keep another narrator; only the captain may say to set it. */
export const OTHER_VOICE_OVERRIDE_ENV = "AIDEOS_ALLOW_OTHER_VOICE";

/** Narrator kinds that are known not to be the voice of choice (backends and Studio provider prefixes). */
const OTHER_NARRATOR_KINDS: readonly string[] = ["kokoro", "google", "say", "tone", "aura", "deepgram", "macos"];

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
export function otherVoiceOverrideActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[OTHER_VOICE_OVERRIDE_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

// Judges one recorded narrator: null when it is the voice of choice (or unknown), an error for another voice, a warning when an override allows it.
export function voiceOfChoiceFinding(ttsBackend: unknown, allowOther: boolean): VoiceOfChoiceFinding | null {
  const kind = narratorKind(ttsBackend);
  if (!OTHER_NARRATOR_KINDS.includes(kind)) return null;
  const spoken = `narrated by "${String(ttsBackend).trim()}", not the voice of choice (the owner's cloned voice, vcd)`;
  if (allowOther) {
    return { severity: "warning", message: `${spoken}; kept because ${OTHER_VOICE_OVERRIDE_ENV} is set. Only the captain may allow another voice.` };
  }
  return {
    severity: "error",
    message: `${spoken}. Narrate it again with the default voice (start the voice service, see "Voice of choice" in docs/PRODUCTION_PIPELINE.md). Only the captain may allow another voice, by setting ${OTHER_VOICE_OVERRIDE_ENV}=1.`,
  };
}
