/**
 * File Description: The word shape shared by the edit-context detectors and the MCP edit tools: the
 * voiceover WordInfo plus an ASR confidence score and a filler flag. No transcription runs in this repo.
 * Inputs and outputs: none (type definitions only) -> TranscribedWord type.
 * Used by: backend/editContext/buildEditContext.ts, backend/editContext/detectFillers.ts, backend/editContext/detectSilences.ts, backend/mcp/server.ts.
 */

import type { WordInfo } from "./audio";

/** A transcribed word: the shared WordInfo shape plus the ASR backend's own confidence score. */
export interface TranscribedWord extends WordInfo {
  confidence?: number;
  /** Set once a filler-detection pass has run over the transcript. Absent until then. */
  filler?: boolean;
}
