/**
 * File Description: Class-name helper for the editor UI primitives.
 * Merges conditional class lists and resolves conflicting Tailwind utilities so a primitive's
 * base classes can always be overridden by a caller's className prop.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join conditional class values and let later Tailwind utilities win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
