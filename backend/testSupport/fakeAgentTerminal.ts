/**
 * File Description: A deterministic fake terminal agent UI (claude or codex style) behind the dispatcher's injectable tmux runner.
 * It reproduces the real failure: an Enter that arrives soon after a large paste is swallowed (the
 * UI is still folding the paste into its input), so the prompt sits unsent in the composer. Time is
 * virtual (`sleep` advances it) so a run is exact and instant.
 * Inputs and outputs: tmux argv from the dispatcher and a virtual clock -> tmux-like results plus a log of pastes, Enters and submissions.
 * Used by: backend/agentBridge/paneDelivery.test.ts, backend/agentBridge/agentBridge.test.ts.
 */

import type { DispatchTmuxRun } from "../agentBridge/dispatcher";

export type FakeAgentKind = "claude" | "codex";

export interface FakeTerminalOptions {
  /** Which agent UI to draw. */
  agent: FakeAgentKind;
  /** The tmux pane id this terminal answers to. */
  pane?: string;
  /** An Enter this many ms (or fewer) after a paste is swallowed. 0 disables the behaviour. */
  swallowEnterWithinMs?: number;
  /** How long the agent works after a prompt is submitted. */
  busyMs?: number;
  /** The agent is already working on something until this virtual time. */
  busyUntil?: number;
  /** Pastes longer than this many characters collapse to a placeholder, like the real UIs. */
  collapsePasteOver?: number;
  /** The text already typed into the composer (a person's half-written message). */
  initialInput?: string;
}

export interface FakeTerminalLog {
  pastes: { at: number; length: number; whileBusy: boolean }[];
  enters: { at: number; swallowed: boolean }[];
  submissions: { at: number; text: string }[];
}

/** A fake agent terminal with a virtual clock; `run` is the tmux runner to inject. */
export class FakeAgentTerminal {
  readonly pane: string;
  readonly log: FakeTerminalLog = { pastes: [], enters: [], submissions: [] };
  private time = 0;
  private input: string;
  private lastPasteAt = Number.NEGATIVE_INFINITY;
  private busyUntil: number;
  private pasteCount = 0;
  private buffers = new Map<string, string>();
  private transcript: string[] = [];
  private readonly opts: Required<Omit<FakeTerminalOptions, "pane" | "initialInput" | "busyUntil">>;

  constructor(options: FakeTerminalOptions) {
    this.pane = options.pane ?? "%42";
    this.input = options.initialInput ?? "";
    this.busyUntil = options.busyUntil ?? 0;
    this.opts = {
      agent: options.agent,
      swallowEnterWithinMs: options.swallowEnterWithinMs ?? 150,
      busyMs: options.busyMs ?? 5000,
      collapsePasteOver: options.collapsePasteOver ?? 200,
    };
  }

  /** The virtual time in ms. */
  now = (): number => this.time;

  /** Advances the virtual clock instead of waiting. */
  sleep = async (ms: number): Promise<void> => {
    this.time += ms;
  };

  /** True while the agent is working on a submitted prompt. */
  isBusy(): boolean {
    return this.time < this.busyUntil;
  }

  /** Marks the agent as working until the given virtual time. */
  setBusyUntil(at: number): void {
    this.busyUntil = at;
  }

  /** The text currently sitting in the composer. */
  composerText(): string {
    return this.input;
  }

  /** The tmux runner: answers has-session, set-buffer, paste-buffer, send-keys and capture-pane. */
  run: DispatchTmuxRun = (args) => {
    const [cmd] = args;
    if (cmd === "has-session") return { status: 0 };
    if (cmd === "set-buffer") {
      this.buffers.set(args[args.indexOf("-b") + 1], args[args.length - 1]);
      return { status: 0 };
    }
    if (args[args.indexOf("-t") + 1] !== this.pane) return { status: 1 };
    if (cmd === "paste-buffer") {
      const text = this.buffers.get(args[args.indexOf("-b") + 1]);
      if (text === undefined) return { status: 1 };
      this.buffers.delete(args[args.indexOf("-b") + 1]);
      this.input += text;
      this.lastPasteAt = this.time;
      this.pasteCount += 1;
      this.log.pastes.push({ at: this.time, length: text.length, whileBusy: this.isBusy() });
      return { status: 0 };
    }
    if (cmd === "send-keys" && args[args.length - 1] === "Enter") {
      const swallowed = this.opts.swallowEnterWithinMs > 0 && this.time - this.lastPasteAt <= this.opts.swallowEnterWithinMs;
      this.log.enters.push({ at: this.time, swallowed });
      if (!swallowed && this.input.length > 0 && !this.isBusy()) {
        this.log.submissions.push({ at: this.time, text: this.input });
        this.transcript.push(this.input.split("\n")[0].slice(0, 60));
        this.input = "";
        this.busyUntil = this.time + this.opts.busyMs;
      }
      return { status: 0 };
    }
    if (cmd === "capture-pane") return { status: 0, stdout: this.render() };
    return { status: 0 };
  };

  /** How the composer shows its text: long pastes fold into a placeholder like the real UIs. */
  private composerShown(): string {
    if (this.input.length > this.opts.collapsePasteOver && this.pasteCount > 0) {
      const lines = this.input.split("\n").length;
      return this.opts.agent === "claude"
        ? `[Pasted text #${this.pasteCount} +${lines} lines]`
        : `[Pasted Content ${this.input.length} chars]`;
    }
    return this.input.split("\n").join("\n  ");
  }

  /** Draws the screen: transcript, an optional working line, the composer and the status footer. */
  private render(): string {
    const claude = this.opts.agent === "claude";
    const glyph = claude ? "❯" : "›";
    const rule = "─".repeat(60);
    const placeholder = claude ? "Try \"fix the lint errors\"" : "Ask Codex to do something";
    const shown = this.composerShown();
    const composer = shown.length > 0 ? `${glyph} ${shown}` : `${glyph} \x1b[2m${placeholder}\x1b[0m`;
    const lines = this.transcript.slice(-4).map((t) => `${glyph} ${t}`);
    lines.push("");
    if (this.isBusy()) {
      const secs = Math.max(1, Math.round((this.time - (this.busyUntil - this.opts.busyMs)) / 1000));
      lines.push(claude ? `✻ Reticulating… (${secs}s · ↓ 1.2k tokens)` : `• Working (${secs}s • esc to interrupt)`);
      lines.push("");
    }
    lines.push(...(claude ? [rule, composer, rule, "  ? for shortcuts"] : [composer, "", "  gpt-5-codex · 83% context left"]));
    return lines.join("\n");
  }
}
