/**
 * File Description: Slab container primitives for the Aideos editor chrome.
 * Panel is the outlined bone slab that carries a named region, PanelHeader is its seam-divided
 * caption bar, PanelBody is the padded scroll region inside it, and Card is the nested slab used
 * for list rows and stat blocks. Together they give every region of the editor the same border
 * weight, seam rhythm, spacing step and hard-shadow depth.
 */

import React from "react";
import { cn } from "./cn";

export type PanelTone = "raised" | "flat" | "sunken";

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** raised = bone slab with a hard shadow, flat = same slab without it, sunken = recessed ground. */
  tone?: PanelTone;
}

const PANEL_TONE: Record<PanelTone, string> = {
  raised: "bg-paper-2 shadow-nb",
  flat: "bg-paper-2",
  sunken: "bg-sunken",
};

/** Outlined slab that carries a named region of the editor. */
export function Panel({ tone = "raised", className, children, ...rest }: PanelProps) {
  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-col border-2 border-ink text-ink", PANEL_TONE[tone], className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface PanelHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** Right-aligned controls for this region. */
  actions?: React.ReactNode;
  /** Fill the caption bar with the primary accent to mark the screen's focal region. */
  accent?: boolean;
}

/** Caption bar for a Panel, separated from the body by a full-weight seam. */
export function PanelHeader({
  title,
  icon,
  actions,
  accent = false,
  className,
  children,
  ...rest
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-[38px] shrink-0 items-center justify-between gap-3 border-b-2 border-ink px-3 py-1.5",
        accent ? "bg-primary" : "bg-paper",
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="shrink-0 text-ink">{icon}</span> : null}
        <h2 className="truncate font-sans text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink">{title}</h2>
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export interface PanelBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Remove the standard padding for regions that manage their own layout. */
  bare?: boolean;
  /** Allow the body to scroll vertically. */
  scroll?: boolean;
}

/** Padded, optionally scrolling content region inside a Panel. */
export function PanelBody({ bare = false, scroll = true, className, children, ...rest }: PanelBodyProps) {
  return (
    <div
      className={cn("min-h-0 flex-1", !bare && "p-3", scroll ? "overflow-y-auto" : "overflow-hidden", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Draw the selected treatment. */
  selected?: boolean;
  /** Make the card behave as a clickable row. */
  interactive?: boolean;
}

/** Nested slab for list rows, stat blocks and inspector groups. */
export function Card({ selected = false, interactive = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "border-2 border-ink bg-paper-3 text-ink transition-[transform,box-shadow,background-color] duration-nb ease-nb",
        interactive && "cursor-pointer shadow-nb-xs hover:-translate-x-px hover:-translate-y-px hover:shadow-nb-sm",
        selected && "bg-select text-select-ink shadow-nb-sm hover:translate-x-0 hover:translate-y-0",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
