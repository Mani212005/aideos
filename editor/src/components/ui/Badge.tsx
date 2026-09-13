/**
 * File Description: Status vocabulary primitives for the Aideos editor chrome.
 * Badge is the small outlined tag used for states, counts and channel labels; Stat is the
 * label/value row used by metric blocks; KeyHint renders a keyboard shortcut as a physical key.
 * All three lock numbers and technical labels to the mono face so readouts line up column-wise.
 */

import React from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "primary" | "select" | "success" | "danger" | "warn" | "info" | "quiet";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-paper-3 text-ink",
  primary: "bg-primary text-ink",
  select: "bg-select text-select-ink",
  success: "bg-success text-ink",
  danger: "bg-danger text-ink",
  warn: "bg-warn text-ink",
  info: "bg-info text-ink",
  quiet: "bg-sunken text-ink-soft",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ReactNode;
}

/** Small outlined tag that names a state, channel or count. */
export function Badge({ tone = "neutral", icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 border-2 border-ink px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase leading-none tracking-[0.06em]",
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
      <span className="font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-ink-soft">{label}</span>
      <span className={cn("font-mono text-[11px] font-bold tabular-nums", STAT_VALUE_TONE[tone])}>{value}</span>
    </div>
  );
}

export interface KeyHintProps {
  /** Keys of the shortcut, for example ["Cmd", "Z"]. */
  keys: string[];
  className?: string;
}

/** Renders a keyboard shortcut as a row of physical-looking keycaps. */
export function KeyHint({ keys, className }: KeyHintProps) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex min-w-[18px] items-center justify-center border-2 border-ink bg-paper-3 px-1 py-px font-mono text-[9px] font-bold uppercase leading-none text-ink shadow-nb-xs"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
