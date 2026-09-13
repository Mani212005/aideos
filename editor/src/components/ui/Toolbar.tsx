/**
 * File Description: Toolbar primitives for the Aideos editor chrome.
 * Toolbar is the seam-bounded control strip above working surfaces, ToolbarGroup clusters related
 * controls, ToolbarDivider draws the hard seam between clusters, and ToolbarLabel is the stencil
 * caption used inside a cluster. Keeping these here means every toolbar in the editor has the same
 * height, padding and separator weight.
 */

import React from "react";
import { cn } from "./cn";

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Where the full-weight seam sits relative to the strip. */
  seam?: "top" | "bottom" | "both" | "none";
  /** Use the recessed ground instead of the standard paper ground. */
  sunken?: boolean;
}

/** Control strip with a full-weight seam against the surface it sits on. */
export function Toolbar({ seam = "bottom", sunken = false, className, children, ...rest }: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 px-2.5 py-2 text-ink",
        sunken ? "bg-sunken" : "bg-paper",
        (seam === "bottom" || seam === "both") && "border-b-2 border-ink",
        (seam === "top" || seam === "both") && "border-t-2 border-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export type ToolbarGroupProps = React.HTMLAttributes<HTMLDivElement>;

/** Cluster of related toolbar controls. */
export function ToolbarGroup({ className, children, ...rest }: ToolbarGroupProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)} {...rest}>
      {children}
    </div>
  );
}

export interface ToolbarDividerProps {
  className?: string;
}

/** Hard vertical seam between toolbar clusters. */
export function ToolbarDivider({ className }: ToolbarDividerProps) {
  return <div aria-hidden className={cn("h-6 w-0.5 shrink-0 bg-ink", className)} />;
}

export type ToolbarLabelProps = React.HTMLAttributes<HTMLSpanElement>;

/** Stencil caption used to name a toolbar cluster. */
export function ToolbarLabel({ className, children, ...rest }: ToolbarLabelProps) {
  return (
    <span
      className={cn(
        "shrink-0 font-sans text-[9px] font-extrabold uppercase leading-none tracking-[0.1em] text-ink-mute",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
