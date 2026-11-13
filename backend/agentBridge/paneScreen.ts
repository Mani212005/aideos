/**
 * File Description: Reads a captured terminal agent screen (claude, codex or any prompt-glyph UI) and says whether the agent is busy,
 * idle at an empty prompt, or has text sitting in its input. Placeholders (dim text) and the cursor (reverse video) do not count as input.
 * Inputs and outputs: tmux capture-pane text (with or without escape sequences) -> {state, composer}.
 * Used by: backend/agentBridge/paneDelivery.ts.
 */

export type PaneScreenState = "busy" | "idle" | "typing" | "unknown";

export interface PaneScreenReading {
  state: PaneScreenState;
  /** The visible text the person (or a paste) put in the input row. Empty when idle. */
  composer: string;
}

// An input row starts with a prompt glyph, optionally inside a box border: "> ", "❯ ", "› ".
const COMPOSER_ROW = /^[\s│|]*([>❯›])(?:\s|$)/;
// Escape sequences other than colours and styles never carry text, so drop them whole.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");
const OTHER_ESCAPES = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-ln-z]|${ESC}\\][^${BEL}]*${BEL}`, "g");
// A working agent says so: "esc to interrupt", or a spinner line like "✻ Reticulating… (2m 6s · ...".
const BUSY_LINES = [/esc to interrupt/i, /ctrl\+c to interrupt/i, /^[\s│]*[^\w\s]\s+[^\n]{1,60}…\s*\(\d+\s*[smh]/];
// How many rows above the input row can hold the working line (spinner, blank, rule).
const BUSY_WINDOW_ROWS = 8;
// Some UIs show an unstyled hint in an empty input.
const UNSTYLED_PLACEHOLDER = /^Try "[^"]*"$/;

/** Removes every escape sequence, leaving the text a person would read. */
function stripEscapes(row: string): string {
  return row.replace(OTHER_ESCAPES, "").replace(SGR, "");
}

/** The text of a row that is neither dim (a placeholder) nor reverse video (the cursor). */
function solidText(row: string): string {
  let faint = false;
  let reverse = false;
  let out = "";
  let last = 0;
  const clean = row.replace(OTHER_ESCAPES, "");
  for (const m of clean.matchAll(SGR)) {
    if (!faint && !reverse) out += clean.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    for (const code of (m[1] || "0").split(";")) {
      if (code === "0" || code === "") {
        faint = false;
        reverse = false;
      } else if (code === "2") faint = true;
      else if (code === "22") faint = false;
      else if (code === "7") reverse = true;
      else if (code === "27") reverse = false;
    }
  }
  if (!faint && !reverse) out += clean.slice(last);
  return out;
}

/** Reads one captured screen: busy beats typing beats idle, and a screen with no input row is unknown. */
export function readPaneScreen(raw: string | undefined): PaneScreenReading {
  const rows = (raw ?? "").split(/\r?\n/);
  while (rows.length > 0 && stripEscapes(rows[rows.length - 1]).trim() === "") rows.pop();
  const plain = rows.map(stripEscapes);
  let at = -1;
  for (let i = plain.length - 1; i >= 0; i--) {
    if (COMPOSER_ROW.test(plain[i])) {
      at = i;
      break;
    }
  }
  if (at < 0) return { state: "unknown", composer: "" };

  const afterGlyph = solidText(rows[at]).replace(/^[\s│|]*[>❯›]/, "");
  let composer = afterGlyph.replace(/[\s│|]+$/g, "").trim();
  if (UNSTYLED_PLACEHOLDER.test(composer)) composer = "";

  const window = plain.slice(Math.max(0, at - BUSY_WINDOW_ROWS), at + 1);
  const busy = window.some((row) => BUSY_LINES.some((re) => re.test(row)));
  return { state: busy ? "busy" : composer ? "typing" : "idle", composer };
}
