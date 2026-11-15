/**
 * File Description: Button primitive for the Aideos editor chrome.
 * A rounded button with a hairline border and no shadow. The primary tone is the one solid accent; the
 * default tone is a white button with a line border. Every editor action uses this component so hover
 * and active feel, focus ring, disabled treatment and tone vocabulary stay identical across the app.
 * Inputs and outputs: button props (variant, size, onClick) -> styled button element.
 * Used by: editor/src/components/ui/index.ts, editor screens and modals.
 */

import React from "react";
import { cn } from "./cn";

export type ButtonTone = "default" | "primary" | "select" | "danger" | "success" | "warn" | "info" | "ghost";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Square button sized for a single icon. */
  iconOnly?: boolean;
  /** Stretch to the full width of the parent. */
  block?: boolean;
  /** Render as visually held down, for toggle-style buttons. */
  active?: boolean;
}

const TONE_CLASSES: Record<ButtonTone, string> = {
  default: "border-line bg-paper-3 text-ink hover:bg-sunken",
  primary: "border-primary bg-primary text-select-ink hover:opacity-90",
  select: "border-select bg-select text-select-ink hover:opacity-90",
  danger: "border-danger bg-danger text-select-ink hover:opacity-90",
  success: "border-success bg-success text-select-ink hover:opacity-90",
  warn: "border-warn bg-warn text-select-ink hover:opacity-90",
  info: "border-info bg-info text-select-ink hover:opacity-90",
  ghost: "border-transparent bg-transparent text-ink-soft hover:bg-sunken hover:text-ink",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-xs gap-1",
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

const ICON_SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "h-6 w-6 px-0",
  sm: "h-8 w-8 px-0",
  md: "h-9 w-9 px-0",
  lg: "h-11 w-11 px-0",
};

/** Editor action button: hairline border, one radius, no shadow. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone = "default",
    size = "sm",
    iconOnly = false,
    block = false,
    active = false,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border font-sans font-semibold leading-none",
        "transition-[background-color,border-color,color,opacity] duration-nb ease-nb",
        "disabled:pointer-events-none disabled:opacity-40",
        SIZE_CLASSES[size],
        iconOnly && ICON_SIZE_CLASSES[size],
        block && "w-full",
        TONE_CLASSES[tone],
        "active:opacity-80",
        active && "border-select bg-select-tint text-select-text hover:bg-select-tint",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
