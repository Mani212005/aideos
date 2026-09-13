/**
 * File Description: Modal dialog primitive for the Aideos editor chrome.
 * Renders a hatched overlay plus an outlined slab dialog, and owns the modal interaction
 * contract: focus moves into the dialog on open, Tab is trapped inside it, Escape closes it,
 * and focus is restored to the element that opened it. Every editor modal uses this shell.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { Button } from "./Button";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /** Right-aligned controls in the dialog footer. */
  footer?: React.ReactNode;
  /** Tailwind max-width class for the dialog slab. */
  width?: string;
  /** Block overlay-click and Escape dismissal while a job is in flight. */
  dismissible?: boolean;
  children: React.ReactNode;
}

/** Outlined dialog with overlay, focus trap, Escape handling and focus restoration. */
export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  footer,
  width = "max-w-xl",
  dismissible = true,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /** Move focus into the dialog on open and return it to the opener on close. */
  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  /** Keep Tab cycling inside the dialog and close it on Escape. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [dismissible, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-ink/70 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "my-auto flex w-full flex-col border-3 border-ink bg-paper-2 shadow-nb-xl outline-none",
          width,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b-2 border-ink bg-primary px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon ? <span className="mt-0.5 shrink-0 text-ink">{icon}</span> : null}
            <div className="min-w-0">
              <h2 className="truncate font-sans text-base font-extrabold uppercase tracking-[-0.01em] text-ink">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-0.5 font-mono text-[11px] leading-snug text-ink/80">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {dismissible ? (
            <Button size="sm" iconOnly onClick={onClose} aria-label="Close dialog" title="Close (Esc)">
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t-2 border-ink bg-paper px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
