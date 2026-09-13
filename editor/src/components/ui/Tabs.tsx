/**
 * File Description: Navigation primitives for the Aideos editor chrome.
 * SegmentedTabs is the horizontal slab switcher used for panel and sub-view modes; RailTab is the
 * vertical stage tab used by the single left navigation rail. Both share the same selected
 * treatment so "where am I" reads identically on either navigation surface.
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
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}

/** Horizontal slab switcher where the active segment is filled with the selection accent. */
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
      className={cn("inline-flex shrink-0 items-stretch border-2 border-ink bg-paper-3 shadow-nb-sm", className)}
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
              "inline-flex items-center gap-1.5 whitespace-nowrap font-sans font-bold uppercase leading-none tracking-[0.06em]",
              "transition-colors duration-nb ease-nb",
              size === "sm" ? "px-2.5 py-1.5 text-[10px]" : "px-3 py-2 text-[11px]",
              idx > 0 && "border-l-2 border-ink",
              isActive ? "bg-select text-select-ink" : "text-ink-soft hover:bg-primary hover:text-ink",
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.suffix ? <span className="font-mono text-[9px] opacity-80">{item.suffix}</span> : null}
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
        "relative flex w-full flex-col items-center gap-1 border-b-2 border-ink py-2.5",
        "font-sans text-[9px] font-extrabold uppercase leading-none tracking-[0.08em]",
        "transition-colors duration-nb ease-nb",
        active ? "bg-select text-select-ink" : "bg-paper-2 text-ink-soft hover:bg-primary hover:text-ink",
      )}
    >
      {typeof index === "number" ? (
        <span
          className={cn(
            "absolute left-1 top-1 font-mono text-[8px] leading-none",
            active ? "text-select-ink/70" : "text-ink-mute",
          )}
        >
          {index}
        </span>
      ) : null}
      {flag !== "none" ? (
        <span className={cn("absolute right-1 top-1 h-2 w-2 border border-ink", FLAG_CLASS[flag])} />
      ) : null}
      {icon}
      <span>{label}</span>
    </button>
  );
}
