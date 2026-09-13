/**
 * File Description: Feedback primitives for the Aideos editor chrome.
 * Covers the states the editor must be able to show without freezing: EmptyState for a region
 * with nothing in it yet, Note for inline result messages, ProgressBar for long running jobs,
 * Spinner for short ones, IconToggle for lane on/off controls, and Toast for non-blocking status
 * that must not interrupt what the user is doing.
 */

import React, { useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary call to action for the empty region. */
  action?: React.ReactNode;
  /** Short numbered steps that teach the user how to fill this region. */
  steps?: React.ReactNode[];
  className?: string;
}

/** Explains why a region is empty, teaches the next step, and offers the action that fills it. */
export function EmptyState({ icon, title, description, action, steps, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "nb-hatch flex h-full w-full flex-col items-center justify-center gap-3 bg-sunken p-8 text-center text-ink",
        className,
      )}
    >
      {icon ? (
        <div className="flex h-14 w-14 items-center justify-center border-2 border-ink bg-primary text-ink shadow-nb-sm">
          {icon}
        </div>
      ) : null}
      <h3 className="max-w-md font-sans text-sm font-extrabold uppercase tracking-[0.04em]">{title}</h3>
      {description ? (
        <p className="max-w-md font-sans text-xs leading-relaxed text-ink-soft">{description}</p>
      ) : null}
      {steps && steps.length > 0 ? (
        <ol className="mt-1 flex max-w-md flex-col gap-1.5 border-2 border-ink bg-paper-2 p-3 text-left">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 font-sans text-[11px] leading-snug text-ink">
              <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center border-2 border-ink bg-primary font-mono text-[9px] font-bold">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export type NoteTone = "info" | "success" | "danger" | "warn" | "quiet";

const NOTE_TONE: Record<NoteTone, string> = {
  info: "bg-info text-ink",
  success: "bg-success text-ink",
  danger: "bg-danger text-ink",
  warn: "bg-warn text-ink",
  quiet: "bg-paper-3 text-ink",
};

export interface NoteProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: NoteTone;
  icon?: React.ReactNode;
}

/** Inline outlined message strip for operation results and validation output. */
export function Note({ tone = "info", icon, className, children, ...rest }: NoteProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-2 border-ink px-2.5 py-1.5 font-mono text-[11px] leading-snug",
        NOTE_TONE[tone],
        className,
      )}
      {...rest}
    >
      {icon ? <span className="mt-px shrink-0">{icon}</span> : null}
      <span className="min-w-0 whitespace-pre-wrap break-words">{children}</span>
    </div>
  );
}

export interface ProgressBarProps {
  /** Completion from 0 to 100. Omit for an indeterminate barber pole. */
  value?: number;
  label?: React.ReactNode;
  className?: string;
  /** Height of the track. */
  size?: "sm" | "md";
}

/** Hard-edged determinate or indeterminate progress track for long operations. */
export function ProgressBar({ value, label, className, size = "md" }: ProgressBarProps) {
  const isDeterminate = typeof value === "number" && Number.isFinite(value);
  const pct = isDeterminate ? Math.max(0, Math.min(100, value as number)) : 100;

  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      {label ? (
        <div className="flex items-baseline justify-between font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-ink-soft">
          <span className="truncate">{label}</span>
          {isDeterminate ? <span className="tabular-nums">{Math.round(pct)}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={isDeterminate ? Math.round(pct) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn("w-full border-2 border-ink bg-paper-3", size === "sm" ? "h-2.5" : "h-4")}
      >
        <div
          className={cn(
            "h-full transition-[width] duration-nb ease-nb",
            isDeterminate ? "bg-select" : "nb-progress-stripes animate-nb-marquee bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export interface SpinnerProps {
  className?: string;
  label?: string;
}

/** Compact busy indicator for short in-place operations. */
export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
      <Loader2 className={cn("h-3.5 w-3.5 animate-spin", className)} />
      {label ? <span className="font-mono text-[10px] uppercase tracking-[0.06em]">{label}</span> : null}
    </span>
  );
}

export interface IconToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  /** Icon shown when the toggle is on. */
  onIcon: React.ReactNode;
  /** Icon shown when the toggle is off. */
  offIcon: React.ReactNode;
  title: string;
  /** Accent used for the on state. */
  tone?: "primary" | "danger" | "warn" | "info" | "select";
  size?: "xs" | "sm";
  className?: string;
}

const TOGGLE_TONE = {
  primary: "bg-primary text-ink",
  danger: "bg-danger text-ink",
  warn: "bg-warn text-ink",
  info: "bg-info text-ink",
  select: "bg-select text-select-ink",
} as const;

/** Square on/off control used for lane visibility, lock and mute. */
export function IconToggle({
  on,
  onChange,
  onIcon,
  offIcon,
  title,
  tone = "primary",
  size = "sm",
  className,
}: IconToggleProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border-2 border-ink transition-colors duration-nb ease-nb",
        size === "xs" ? "h-[18px] w-[18px]" : "h-5 w-5",
        on ? TOGGLE_TONE[tone] : "bg-paper-3 text-ink-mute hover:bg-sunken hover:text-ink",
        className,
      )}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}

export interface ToastMessage {
  id: number;
  tone: NoteTone;
  text: string;
  /** Optional progress percentage rendered under the message for in-flight jobs. */
  progress?: number;
  /** Keep the toast until it is dismissed or replaced instead of auto-expiring. */
  sticky?: boolean;
}

export interface ToastStackProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
  className?: string;
}

/** Non-blocking stack of status messages anchored to the bottom of the app shell. */
export function ToastStack({ toasts, onDismiss, className }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className={cn("pointer-events-none fixed bottom-3 left-1/2 z-[90] flex w-[min(560px,92vw)] -translate-x-1/2 flex-col gap-1.5", className)}
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}

/** One auto-expiring status slab inside the toast stack. */
function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toast.sticky) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), 5200);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.sticky, onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2 border-2 border-ink px-3 py-2 shadow-nb",
        NOTE_TONE[toast.tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words font-mono text-[11px] font-bold leading-snug">{toast.text}</p>
        {typeof toast.progress === "number" ? (
          <div className="mt-1.5 h-2 w-full border-2 border-ink bg-paper-3">
            <div
              className="h-full bg-ink transition-[width] duration-nb ease-nb"
              style={{ width: `${Math.max(0, Math.min(100, toast.progress))}%` }}
            />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss message"
        className="shrink-0 border-2 border-ink bg-paper-3 p-0.5 text-ink hover:bg-primary"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
