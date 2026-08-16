/**
 * File Description: Perception and script analyzer module for the GenClaw video engine.
 * Parses user prompts and scripts, injects Video Design Language constraints (#0A0A0B canvas,
 * Geist and JetBrains Mono typography), and produces shot layout specifications with Kokoro TTS alignment hints.
 */

export interface DesignConstraints {
  canvasColor: string;
  primaryTextColor: string;
  mutedTextColor: string;
  accentColor: string;
  hairlineColor: string;
  surfaceColor: string;
  sansFont: string;
  monoFont: string;
  motionEasing: string;
}

export interface KokoroTTSHint {
  word: string;
  startFrame: number;
  endFrame: number;
  startTime: number;
  endTime: number;
}

export interface ShotElementSpec {
  id: string;
  type: "text" | "code" | "card" | "counter" | "divider" | "icon_label" | "progress_bar";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  content: string;
  font: string;
  color: string;
}

export interface ShotLayoutSpec {
  shotId: string;
  headline: string;
  narrative: string;
  fps: number;
  durationInFrames: number;
  elements: ShotElementSpec[];
  ttsAlignmentHints: KokoroTTSHint[];
  constraints: DesignConstraints;
}

export interface PerceptionOutput {
  parsedPrompt: string;
  shots: ShotLayoutSpec[];
  totalDurationInFrames: number;
  designSystemApplied: boolean;
}

// Returns the locked 6-value HSL/HEX color palette and font typography constraints.
export function getDefaultDesignConstraints(): DesignConstraints {
  return {
    canvasColor: "#0A0A0B",
    primaryTextColor: "#F5F5F5",
    mutedTextColor: "#8A8A8E",
    accentColor: "#635BFF",
    hairlineColor: "rgba(245,245,245,0.10)",
    surfaceColor: "#101013",
    sansFont: "Geist",
    monoFont: "JetBrains Mono",
    motionEasing: "cubic-bezier(0.16, 1, 0.3, 1)",
  };
}

// Deconstructs raw script text into discrete narrative shot topics.
export function parseUserScript(scriptText: string): string[] {
  if (!scriptText || scriptText.trim() === "") {
    return ["Introduction to concept"];
  }

  const rawLines = scriptText
    .split(/\n|\./)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return rawLines.length > 0 ? rawLines : [scriptText.trim()];
}

// Generates Kokoro 82M TTS word-level alignment timing hints.
export function generateKokoroTTSHints(
  text: string,
  fps: number = 30,
  wordDurationSeconds: number = 0.35
): KokoroTTSHint[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const hints: KokoroTTSHint[] = [];

  let currentTime = 0;
  for (const word of words) {
    const startTime = currentTime;
    const endTime = currentTime + wordDurationSeconds;
    const startFrame = Math.round(startTime * fps);
    const endFrame = Math.round(endTime * fps);

    hints.push({
      word,
      startTime,
      endTime,
      startFrame,
      endFrame,
    });

    currentTime = endTime + 0.05;
  }

  return hints;
}

// Analyzes user prompt, injects Video Design Language constraints, and builds shot layout specifications.
export function analyzePerception(
  prompt: string,
  options?: { fps?: number; width?: number; height?: number }
): PerceptionOutput {
  const fps = options?.fps ?? 30;
  const viewportWidth = options?.width ?? 1920;
  const viewportHeight = options?.height ?? 1080;

  const constraints = getDefaultDesignConstraints();
  const rawSegments = parseUserScript(prompt);

  let totalDurationInFrames = 0;
  const shots: ShotLayoutSpec[] = [];

  rawSegments.forEach((segment, index) => {
    const shotId = `shot_${index + 1}`;
    const ttsAlignmentHints = generateKokoroTTSHints(segment, fps);
    const durationInFrames = Math.max(
      60,
      ttsAlignmentHints.length > 0
        ? ttsAlignmentHints[ttsAlignmentHints.length - 1].endFrame + 15
        : 90
    );

    const headlineElement: ShotElementSpec = {
      id: `${shotId}_headline`,
      type: "text",
      x: Math.round(viewportWidth * 0.1),
      y: Math.round(viewportHeight * 0.15),
      width: Math.round(viewportWidth * 0.8),
      height: 80,
      zIndex: 1,
      content: segment.substring(0, 50),
      font: constraints.sansFont,
      color: constraints.primaryTextColor,
    };

    const cardElement: ShotElementSpec = {
      id: `${shotId}_card`,
      type: "card",
      x: Math.round(viewportWidth * 0.1),
      y: Math.round(viewportHeight * 0.35),
      width: Math.round(viewportWidth * 0.8),
      height: Math.round(viewportHeight * 0.5),
      zIndex: 0,
      content: segment,
      font: constraints.monoFont,
      color: constraints.surfaceColor,
    };

    shots.push({
      shotId,
      headline: segment.substring(0, 40),
      narrative: segment,
      fps,
      durationInFrames,
      elements: [headlineElement, cardElement],
      ttsAlignmentHints,
      constraints,
    });

    totalDurationInFrames += durationInFrames;
  });

  return {
    parsedPrompt: prompt,
    shots,
    totalDurationInFrames,
    designSystemApplied: true,
  };
}
