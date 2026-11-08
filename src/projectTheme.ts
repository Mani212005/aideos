/**
 * File Description: The themes a new project can choose and the rule that the chosen theme is binding.
 * The New project dialog offers these themes; the project stores the choice on `film.theme` (its
 * background preset and accent). Every later stage reads that choice back from here: the agent task
 * prompt, the agent briefs and the design check, so no stage falls back to a colour of its own.
 * Inputs and outputs: theme ids, accents and films -> theme options, resolved theme, bound theme.
 * Used by: editor/src/components/NewProjectModal.tsx, editor/vite.config.ts,
 * backend/agentBridge/contextBuilder.ts, backend/designSpec/brief.ts, backend/lookPlan/brief.ts,
 * backend/designCheck/designCheck.ts, backend/pipeline/design.ts.
 */

/** One theme in the New project dialog. */
export interface ProjectThemeOption {
  id: string;
  name: string;
  accent: string;
  swatch: string;
}

/** The themes the New project dialog offers; `id` is a `film.theme.background` preset (the schema rejects any other value). */
export const PROJECT_THEMES: readonly ProjectThemeOption[] = [
  { id: "smooth-dark", name: "Smooth Dark", accent: "#FF6B00", swatch: "#0A0A0B" },
  { id: "paper-white", name: "Paper White", accent: "#635BFF", swatch: "#F5F5F5" },
  { id: "blueprint", name: "Blueprint", accent: "#00E5FF", swatch: "#F5F5F5" },
  { id: "dot-grid", name: "Terminal Dots", accent: "#10B981", swatch: "#F5F5F5" },
];

/** The theme a project gets when its creator chose none. */
export const DEFAULT_PROJECT_THEME_ID = "smooth-dark";

/** The theme and accent a project is bound to. */
export interface BoundTheme {
  background: string;
  accent: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Looks up a dialog theme by id, falling back to the default theme. */
export function projectThemeById(id: string | undefined): ProjectThemeOption {
  return PROJECT_THEMES.find((t) => t.id === id) ?? PROJECT_THEMES.find((t) => t.id === DEFAULT_PROJECT_THEME_ID)!;
}

/** Resolves the theme and accent a new project is created with: the creator's choice, else the chosen theme's own accent. */
export function resolveProjectTheme(themeId: string | undefined, accent: string | undefined): BoundTheme {
  const theme = projectThemeById(themeId);
  return { background: theme.id, accent: accent && HEX.test(accent) ? accent : theme.accent };
}

/** The theme a film is bound to (its chosen background and accent), or null when it records no chosen accent. */
export function boundTheme(film: { theme?: { background?: string; accent?: string } } | null | undefined): BoundTheme | null {
  const accent = film?.theme?.accent;
  if (!accent || !HEX.test(accent)) return null;
  return { background: film?.theme?.background ?? DEFAULT_PROJECT_THEME_ID, accent };
}

/** Compares two #rrggbb colours ignoring case. */
export function sameColour(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

/** The accent a film draws with: its chosen one, else its manifest accent, else the default theme's accent. */
export function filmAccent(film: { accent?: string; theme?: { background?: string; accent?: string } } | null | undefined): string {
  return boundTheme(film)?.accent ?? (film?.accent && HEX.test(film.accent) ? film.accent : projectThemeById(DEFAULT_PROJECT_THEME_ID).accent);
}
