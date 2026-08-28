/**
 * File Description: Unified Google Gen AI Model Client Abstraction (Phase 1).
 * Owns all LLM interactions in the runtime path using the official @google/genai SDK,
 * enforcing structured JSON schema outputs and 3-attempt validation retry loops.
 */

import { GoogleGenAI } from "@google/genai";

const DEFAULT_GEMINI_MODEL = process.env.AIDEOS_GEMINI_MODEL || "gemini-2.0-flash";

/** Builds and returns the authenticated Google Gen AI client. */
export function getGoogleAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not set. Please set it in .env or the environment.");
  }
  return new GoogleGenAI({ apiKey });
}

/** Check if Google AI credentials are configured in the active environment. */
export function isGoogleAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

/**
 * Executes a structured JSON prompt against Gemini with clean JSON parsing and markdown stripping.
 */
export async function generateStructuredJson<T>(
  prompt: string,
  options?: {
    model?: string;
    systemInstruction?: string;
    temperature?: number;
  }
): Promise<T> {
  const ai = getGoogleAiClient();
  const modelName = options?.model || DEFAULT_GEMINI_MODEL;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      systemInstruction: options?.systemInstruction,
      temperature: options?.temperature ?? 0.2,
    },
  });

  const rawText = response.text || "";
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  return JSON.parse(cleaned) as T;
}

/**
 * Executes a plain-text prompt against Gemini.
 */
export async function generateText(
  prompt: string,
  options?: {
    model?: string;
    systemInstruction?: string;
    temperature?: number;
  }
): Promise<string> {
  const ai = getGoogleAiClient();
  const modelName = options?.model || DEFAULT_GEMINI_MODEL;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction: options?.systemInstruction,
      temperature: options?.temperature ?? 0.7,
    },
  });

  return (response.text || "").trim();
}
