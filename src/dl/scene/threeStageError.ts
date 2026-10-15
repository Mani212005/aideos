/**
 * File Description: Reports Three stage WebGL initialization failures through the preview or export contract.
 * Inputs and outputs: initialization error and render environment -> visible Player status or canceled export.
 * Used by: ThreeStage's canvas error boundary and its focused behavior test.
 */

// Routes a canvas initialization failure to the Player status or the export cancellation path.
export function reportThreeStageInitializationFailure(
  error: Error,
  sceneId: string,
  isPlayer: boolean,
  ready: (message: string) => void,
  cancelRender: (error: Error) => void,
): void {
  const reason = error.message || "unknown error";
  if (isPlayer) {
    ready(`Scene graphics unavailable: WebGL could not start (${reason})`);
    return;
  }
  const message = `Three stage ${sceneId}: WebGL could not start: ${reason}`;
  ready(message);
  cancelRender(new Error(message));
}
