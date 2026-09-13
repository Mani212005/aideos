/**
 * File Description: Form control primitives for the Aideos editor chrome.
 * Field pairs a stencil-style label with its control and an optional hint, and Input, Textarea,
 * Select, NumberStepper and Range are the hard-edged controls themselves. Every control carries
 * the same 2px ink border, white ground and loud focus state so forms read as one system.
 */

import React, { useId } from "react";
import { cn } from "./cn";

const CONTROL_BASE =
  "w-full border-2 border-ink bg-paper-3 px-2.5 py-1.5 font-mono text-xs text-ink " +
  "placeholder:text-ink-mute focus:outline-none focus-visible:outline-none " +
  "focus:border-select focus:shadow-[inset_0_0_0_1px_var(--nb-select)] " +
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-mute " +
  "transition-[border-color,box-shadow] duration-nb ease-nb";

export interface FieldProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** Right-aligned value readout or control shown beside the label. */
  aside?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

/** Labelled wrapper that gives every control the same label rhythm and hint slot. */
export function Field({ label, hint, aside, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="font-sans text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-soft">
          {label}
        </label>
        {aside ? <span className="font-mono text-[10px] text-ink-mute">{aside}</span> : null}
      </div>
      {children}
      {hint ? <p className="font-sans text-[10px] leading-snug text-ink-mute">{hint}</p> : null}
    </div>
  );
}

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** Single-line text control with a hard ink border and a loud focus state. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(CONTROL_BASE, className)} {...rest} />;
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line text control used by script, prompt and note surfaces. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(CONTROL_BASE, "leading-relaxed", className)} {...rest} />;
});

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/** Native select restyled as a hard-edged slab with a stencil caret. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        CONTROL_BASE,
        "cursor-pointer appearance-none bg-[length:10px] bg-[right_0.6rem_center] bg-no-repeat pr-7",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0h10L5 6z' fill='%2314140f'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface RangeProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/** Hard-edged slider used for zoom, speed and scalar settings. */
export const Range = React.forwardRef<HTMLInputElement, RangeProps>(function Range({ className, ...rest }, ref) {
  return <input ref={ref} type="range" className={cn("nb-range", className)} {...rest} />;
});

export interface NumberStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Suffix rendered inside the control, for example "s" or "f". */
  unit?: string;
  /** Fixed decimal places used when formatting the displayed value. */
  precision?: number;
  disabled?: boolean;
  title?: string;
  className?: string;
  id?: string;
}

/** Precise numeric entry with clamping, used for times, durations and frame counts. */
export function NumberStepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 0.1,
  unit,
  precision = 2,
  disabled = false,
  title,
  className,
  id,
}: NumberStepperProps) {
  const [draft, setDraft] = React.useState<string | null>(null);

  /** Clamp a candidate number into the configured range and round it to the precision. */
  const clamp = (n: number) => Number(Math.min(max, Math.max(min, n)).toFixed(precision));

  /** Commit the in-progress text draft, falling back to the current value when unparseable. */
  const commit = () => {
    if (draft === null) return;
    const parsed = Number.parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
  };

  return (
    <div className={cn("inline-flex h-8 items-stretch border-2 border-ink bg-paper-3", className)} title={title}>
      <input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? value.toFixed(precision)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onChange(clamp(value + step));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp(value - step));
          }
        }}
        className="w-16 bg-transparent px-1.5 text-right font-mono text-[11px] font-bold tabular-nums text-ink outline-none disabled:text-ink-mute"
      />
      {unit ? (
        <span className="flex items-center pr-1 font-mono text-[10px] font-bold text-ink-mute">{unit}</span>
      ) : null}
      <div className="flex w-5 shrink-0 flex-col border-l-2 border-ink">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Increase"
          onClick={() => onChange(clamp(value + step))}
          className="flex h-1/2 items-center justify-center border-b border-ink bg-paper text-[8px] leading-none text-ink hover:bg-primary disabled:opacity-40"
        >
          &#9650;
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Decrease"
          onClick={() => onChange(clamp(value - step))}
          className="flex h-1/2 items-center justify-center bg-paper text-[8px] leading-none text-ink hover:bg-primary disabled:opacity-40"
        >
          &#9660;
        </button>
      </div>
    </div>
  );
}

export interface LabelledInputProps extends InputProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  aside?: React.ReactNode;
  wrapperClassName?: string;
}

/** Convenience pairing of Field and Input that wires up the label association. */
export function LabelledInput({ label, hint, aside, wrapperClassName, ...rest }: LabelledInputProps) {
  const id = useId();
  return (
    <Field label={label} hint={hint} aside={aside} htmlFor={id} className={wrapperClassName}>
      <Input id={id} {...rest} />
    </Field>
  );
}
