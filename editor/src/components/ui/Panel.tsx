/**
 * File Description: Surface container primitives for the Aideos editor chrome.
 * Panel is the white surface with a hairline border that carries a named region, PanelHeader is its
 * seam-divided caption bar, PanelBody is the padded scroll region inside it, and Card is the nested
 * surface used for list rows and stat blocks. Together they give every region of the editor the same
 * border weight, corner radius and spacing step. There is no shadow.
 * Inputs and outputs: panel title, actions, and children -> styled container panel.
 * Used by: editor/src/components/ui/index.ts, editor stages and inspectors.
 */

import React from "react";
import { cn } from "./cn";

export type PanelTone = "raised" | "flat" | "sunken";

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** raised and flat = white surface (kept as two names for existing callers), sunken = recessed ground. */
  tone?: PanelTone;
}

const PANEL_TONE: Record<PanelTone, string> = {
  raised: "bg-paper-2",
  flat: "bg-paper-2",
  sunken: "bg-sunken",
};

/** White surface with a hairline border that carries a named region of the editor. */
export function Panel({ tone = "raised", className, children, ...rest }: PanelProps) {
  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line text-ink", PANEL_TONE[tone], className)}
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
  /** Tint the caption bar with the accent to mark the screen's focal region. */
  accent?: boolean;
}

/** Caption bar for a Panel, separated from the body by a hairline seam. */
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
        "flex min-h-[38px] shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-1.5",
        accent ? "bg-select-tint" : "bg-paper-2",
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="shrink-0 text-ink">{icon}</span> : null}
        <h2 className="truncate font-sans text-xs font-semibold text-ink">{title}</h2>
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

/** Nested surface for list rows, stat blocks and inspector groups. */
export function Card({ selected = false, interactive = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-paper-3 text-ink transition-[background-color,border-color] duration-nb ease-nb",
        interactive && "cursor-pointer hover:bg-paper",
        selected && "border-select bg-select-tint",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
