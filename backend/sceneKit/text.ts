/**
 * File Description: Shared text manipulation helpers for the scene-film kit.
 */

// Lowercases a word and strips everything but letters and digits, for matching spoken to scripted.
export function norm(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Strips the spoken-span `{n}` suffix off a display token.
export function bare(token: string): string {
  return token.replace(/\{\d+\}$/, "");
}

// Strips all display markup (accent stars and `{n}` spoken-span suffixes) so a token is measured as drawn.
export function shape(token: string): string {
  return bare(token).replace(/\*/g, "");
}
