/**
 * File Description: Retired paper-rip transition shim kept as a no-op for backward-compatible transition references.
 */

import React from "react";

export type PaperRipProps = {
  active: boolean;
  progress: number;
  frame?: number;
};

// Suppresses the retired off-language wipe while preserving existing transition references.
export const PaperRip: React.FC<PaperRipProps> = ({ active, progress, frame = 0 }) => {
  void active;
  void progress;
  void frame;
  return null;
};
