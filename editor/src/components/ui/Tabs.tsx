/**
 * File Description: Navigation primitives for the Aideos editor chrome.
 * SegmentedTabs is the horizontal segmented switcher used for panel and sub-view modes; RailTab is the
 * vertical stage tab used by the single left navigation rail. Both share the same selected
 * treatment so "where am I" reads identically on either navigation surface.
 * Inputs and outputs: tab items, active key, and onChange -> tabbed navigation header.
 * Used by: editor/src/components/ui/index.ts, editor stages.
 */

import React from "react";
import { cn } from "./cn";

export interface SegmentedTabItem<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Optional count or state suffix rendered in mono after the label. */
  suffix?: React.ReactNode;
  title?: string;
}

export interface SegmentedTabsProps<T extends string> {
  items: ReadonlyArray<SegmentedTabItem<NoInfer<T>>>;
  value: T;
  onChange: (value: NoInfer<T>) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}

/** Horizontal segmented switcher where the active segment is filled with the accent. */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("inline-flex shrink-0 items-stretch overflow-hidden rounded-lg border border-line bg-paper-3", className)}
    >
      {items.map((item, idx) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={isActive}
            title={item.title ?? item.label}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap font-sans font-semibold leading-none",
              "transition-colors duration-nb ease-nb",
              size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-xs",
              idx > 0 && "border-l border-line",
              isActive ? "bg-select text-select-ink" : "text-ink-soft hover:bg-sunken hover:text-ink",
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.suffix ? <span className="font-mono text-xs opacity-80">{item.suffix}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface RailTabProps {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
  /** Small state dot rendered in the corner, for example when a stage needs attention. */
  flag?: "none" | "warn" | "success";
  /** Ordinal shown in the corner so the workflow order is visible. */
  index?: number;
}

const FLAG_CLASS = {
  none: "",
  warn: "bg-warn",
  success: "bg-success",
} as const;

/** Vertical stage tab for the single left navigation rail. */
export function RailTab({ label, icon, active, onClick, title, flag = "none", index }: RailTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full flex-col items-center gap-1 border-b border-line py-2.5",
        "font-sans text-xs font-semibold leading-none",
        "transition-colors duration-nb ease-nb",
        active ? "bg-select text-select-ink" : "bg-paper-2 text-ink-soft hover:bg-sunken hover:text-ink",
      )}
    >
      {typeof index === "number" ? (
        <span
          className={cn(
            "absolute left-1 top-1 font-mono text-xs leading-none",
            active ? "text-select-ink/70" : "text-ink-mute",
          )}
        >
          {index}
        </span>
      ) : null}
      {flag !== "none" ? (
        <span className={cn("absolute right-1 top-1 h-2 w-2 rounded-full", FLAG_CLASS[flag])} />
      ) : null}
      {icon}
      <span>{label}</span>
    </button>
  );
}
