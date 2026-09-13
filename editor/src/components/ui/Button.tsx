/**
 * File Description: Neobrutalism button primitive for the Aideos editor chrome.
 * A slab with a hard ink border and a blur-free offset shadow that visibly depresses on press
 * (the slab translates into its own shadow). Every editor action uses this component so press
 * feel, focus ring, disabled treatment and tone vocabulary stay identical across the app.
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
  default: "bg-paper-3 text-ink",
  primary: "bg-primary text-ink",
  select: "bg-select text-select-ink",
  danger: "bg-danger text-ink",
  success: "bg-success text-ink",
  warn: "bg-warn text-ink",
  info: "bg-info text-ink",
  ghost: "border-transparent bg-transparent text-ink-soft shadow-none",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[10px] gap-1",
  sm: "h-8 px-2.5 text-[11px] gap-1.5",
  md: "h-9 px-3.5 text-xs gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

const ICON_SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "h-6 w-6 px-0",
  sm: "h-8 w-8 px-0",
  md: "h-9 w-9 px-0",
  lg: "h-11 w-11 px-0",
};

/** Chunky editor action button that depresses into its own hard shadow on press. */
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
  const isGhost = tone === "ghost";

  return (
    <button
      ref={ref}
      type={type}
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap border-2 font-sans font-bold uppercase tracking-[0.06em] leading-none",
        "transition-[transform,box-shadow,background-color,color] duration-nb ease-nb",
        "disabled:pointer-events-none disabled:opacity-40",
        SIZE_CLASSES[size],
        iconOnly && ICON_SIZE_CLASSES[size],
        block && "w-full",
        TONE_CLASSES[tone],
        isGhost
          ? "hover:bg-paper-3 hover:text-ink"
          : "border-ink shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        active && !isGhost && "translate-x-0.5 translate-y-0.5 shadow-none",
        active && isGhost && "bg-ink text-paper hover:bg-ink hover:text-paper",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
