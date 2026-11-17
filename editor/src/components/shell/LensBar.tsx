/**
 * File Description: The lens bar. Four lenses in workflow order (Words, Look, Cut, Check) as one row of tabs under the header. A small dot marks a lens that needs attention. The bar replaces the left rail and keeps the aria-label "Production stages".
 * Inputs and outputs: the lenses, the open one and a callback -> a navigation row.
 * Used by: editor/src/App.tsx.
 */

import type { ReactNode } from "react";
import { cn } from "../ui";

export interface Lens<Id extends string> {
  id: Id;
  label: string;
  icon: ReactNode;
  title: string;
}

export interface LensBarProps<Id extends string> {
  lenses: ReadonlyArray<Lens<Id>>;
  /** The open lens, or null while the Films home shows. */
  active: Id | null;
  /** A lens that needs attention gets a dot. */
  flags: Partial<Record<Id, "warn" | "success">>;
  onSelect: (id: Id) => void;
}

/** One row of lens tabs. */
export function LensBar<Id extends string>({ lenses, active, flags, onSelect }: LensBarProps<Id>) {
  return (
    <nav aria-label="Production stages" className="flex h-10 shrink-0 items-stretch gap-1 border-b border-line bg-paper-2 px-2">
      {lenses.map((lens, i) => {
        const on = lens.id === active;
        const flag = flags[lens.id];
        return (
          <button
            key={lens.id}
            type="button"
            onClick={() => onSelect(lens.id)}
            title={`${lens.title} (${i + 1})`}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 font-sans text-xs font-semibold transition-colors duration-nb ease-nb sm:flex-none sm:px-4",
              on ? "border-select text-select-text" : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {lens.icon}
            <span>{lens.label}</span>
            {flag ? <span className={cn("h-1.5 w-1.5 rounded-full", flag === "warn" ? "bg-warn" : "bg-success")} aria-hidden /> : null}
          </button>
        );
      })}
    </nav>
  );
}
