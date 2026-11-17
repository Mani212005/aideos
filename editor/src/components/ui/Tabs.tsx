/**
 * File Description: Navigation primitives for the Aideos editor chrome.
 * SegmentedTabs is the horizontal segmented switcher used for panel and sub-view modes.
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
