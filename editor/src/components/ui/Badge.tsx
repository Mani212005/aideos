/**
 * File Description: Status vocabulary primitives for the Aideos editor chrome.
 * Badge is the small pill used for states, counts and channel labels; Stat is the
 * label/value row used by metric blocks; KeyHint renders a keyboard shortcut as a small key.
 * All three lock numbers and technical labels to the mono face so readouts line up column-wise.
 * Inputs and outputs: badge label and variant -> rendered badge UI element.
 * Used by: editor/src/components/ui/index.ts, editor screens and inspectors.
 */

import React from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "primary" | "select" | "success" | "danger" | "warn" | "info" | "quiet";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-line bg-paper-3 text-ink",
  primary: "border-primary bg-primary text-select-ink",
  select: "border-select bg-select text-select-ink",
  success: "border-success/40 bg-success/10 text-success",
  danger: "border-danger/40 bg-danger/10 text-danger",
  warn: "border-warn/40 bg-warn/10 text-warn",
  info: "border-info/40 bg-info/10 text-info",
  quiet: "border-line bg-sunken text-ink-soft",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ReactNode;
}

/** Small pill that names a state, channel or count. */
export function Badge({ tone = "neutral", icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs font-semibold leading-none",
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "ink" | "select" | "success" | "warn" | "danger";
  className?: string;
}

/** Value colours use the text-safe accent variants so a small mono number still passes AA. */
const STAT_VALUE_TONE: Record<NonNullable<StatProps["tone"]>, string> = {
  ink: "text-ink",
  select: "text-select-text",
  success: "text-ink",
  warn: "text-ink",
  danger: "text-danger-text",
};

/** Label and value row used inside metric blocks, with the value locked to mono. */
export function Stat({ label, value, tone = "ink", className }: StatProps) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-0.5", className)}>
      <span className="font-sans text-xs font-semibold uppercase text-ink-soft">{label}</span>
      <span className={cn("font-mono text-xs font-semibold tabular-nums", STAT_VALUE_TONE[tone])}>{value}</span>
    </div>
  );
}

export interface KeyHintProps {
  /** Keys of the shortcut, for example ["Cmd", "Z"]. */
  keys: string[];
  className?: string;
}

/** Renders a keyboard shortcut as a row of small keys. */
export function KeyHint({ keys, className }: KeyHintProps) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex min-w-[18px] items-center justify-center rounded border border-line bg-paper-3 px-1 py-px font-mono text-xs leading-none text-ink"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
