/**
 * File Description: Defines the 12-criterion good-video quality rubric, gate classifications,
 * structured JSON schemas, prompt templates, and timestamp evidence validation for Gemini review.
 */

import type { CriterionEvaluation } from "./types";

export interface RubricCriterionDefinition {
  name: string;
  title: string;
  isGate: boolean;
  description: string;
  passTarget: string;
}

export const RUBRIC_CRITERIA: RubricCriterionDefinition[] = [
  {
    name: "persistent_stage",
    title: "One persistent stage",
    isGate: true,
    description:
      "One unified visual stage. Elements persist across beat boundaries rather than being wiped clean. Stage-clears must be <= 1 per 30s. No jump cuts between disconnected static layouts.",
    passTarget: "Stage-clears <= 1 per 30s; layout continuity maintained across beats",
  },
  {
    name: "carry_over_transformation",
    title: "Carry-over with transformation",
    isGate: false,
    description:
      "Elements carry over between beats and visibly change position, scale, shape, or role (e.g. points tilt into 3D layers, query drops layer to layer, graph slides and transforms into a pipeline card).",
    passTarget: "At least 1 transforming carry-over event per 20s",
  },
  {
    name: "visible_cause_effect",
    title: "Visible cause and effect",
    isGate: false,
    description:
      "Every narrated mechanism or action verb is paired with an animation starting within 0.4s of the spoken keyword that visibly moves or transforms the named object.",
    passTarget: "Animations directly depict the spoken action keywords in real time",
  },
  {
    name: "camera_purpose",
    title: "Camera that does something",
    isGate: true,
    description:
      "Purposeful camera movement (pan, zoom, tilt, payoff pull-back) with at least 1 move per 20s. Every move must change what is framed; no aimless drift or frantically fast pans (>20% width/sec).",
    passTarget: "Purposeful framing changes >= 1 per 20s; smooth cinematic motion",
  },
  {
    name: "bottom_captions",
    title: "Bottom captions",
    isGate: true,
    description:
      "Burned-in caption band located in the bottom 20-22% of the frame for >= 95% of narrated time. Clean typography (>= 36px at 1080p), max 2 lines, no widows, exactly matching spoken voiceover words.",
    passTarget: "Present in bottom band for >= 95% of speech; words synchronized",
  },
  {
    name: "readability",
    title: "Readability",
    isGate: true,
    description:
      "All on-screen text is legible (body text >= 24px, labels >= 20px at 1080p), high contrast (>= 4.5:1), and dwells on screen for >= 0.35s per word. No microscopic or unreadable text.",
    passTarget: "Zero unreadable text violations; contrast and dwell times met",
  },
  {
    name: "no_overlap_clipping",
    title: "No overlap or clipping",
    isGate: true,
    description:
      "Zero collisions between text blocks, zero text intersecting graphics, zero artwork clipped outside screen bounds, and all critical content respects safe margins (>= 96px at 1080p).",
    passTarget: "Zero text-text or text-art collisions; zero edge clippings",
  },
  {
    name: "audio_sync",
    title: "Audio sync",
    isGate: true,
    description:
      "Visual cues land within 120ms of spoken words. Shot transitions occur during natural speech pauses. Total video duration matches voiceover audio duration within 100ms.",
    passTarget: "Cues aligned within 120ms; voiceover and video durations match",
  },
  {
    name: "pacing",
    title: "Pacing",
    isGate: false,
    description:
      "Dynamic visual rhythm: no static frame held unchanged for > 3s, mean beat length 5-12s, no dead air > 0.7s, narration delivery pace 130-170 words per minute.",
    passTarget: "Continuous visual motion; no static freezes > 3s; natural delivery",
  },
  {
    name: "storyline",
    title: "Storyline",
    isGate: false,
    description:
      "Clear narrative arc: problem statement introduced upfront, each beat logically builds upon the previous one without disjointed leaps, concluding with an integrated payoff scene.",
    passTarget: "Logical build; beats cannot be arbitrarily reordered; clear payoff",
  },
  {
    name: "accuracy_honesty",
    title: "Accuracy and honesty",
    isGate: false,
    description:
      "Every number, metric, and label shown on screen is spoken in the narration or clearly marked illustrative. Diagrams accurately portray the actual computational mechanism.",
    passTarget: "Zero ungrounded numbers or misleading visual claims",
  },
  {
    name: "audio_mix",
    title: "Loudness and mix",
    isGate: false,
    description:
      "Clean, professional audio mix: integrated loudness -14 to -18 LUFS, true peak <= -1 dBFS, zero audio clipping, background music ducked >= 12dB under voice, voice is crisp.",
    passTarget: "-14 to -18 LUFS; zero clipping; voiceover clearly intelligible",
  },
];

// Validates that each criterion in the review contains at least one concrete timestamp reference.
export function validateCriterionTimestamps(criteria: CriterionEvaluation[]): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  const timestampRegex = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:-|to)\s*\d{1,2}:\d{2}(?::\d{2})?)?\b/i;

  for (const crit of criteria) {
    const hasEvidenceArray =
      Array.isArray(crit.evidenceTimestamps) &&
      crit.evidenceTimestamps.some((ts) => ts && typeof ts === "string" && timestampRegex.test(ts.trim()));

    const hasTimestampInReason = typeof crit.reason === "string" && timestampRegex.test(crit.reason);

    if (!hasEvidenceArray && !hasTimestampInReason) {
      missing.push(crit.name || crit.title || "unnamed criterion");
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

// Builds the detailed prompt for single video evaluation against the 12-criterion rubric.
export function buildSingleVideoReviewPrompt(
  videoPathOrFeedback?: string,
  reAskFeedbackOrReviewJson?: string,
  deterministicReviewJsonOrFacts?: string,
  deterministicFactsText?: string,
): string {
  let videoPath: string | undefined;
  let reAskFeedback: string | undefined;
  let deterministicReviewJson: string | undefined;
  let factsText = deterministicFactsText;

  const isVideo =
    typeof videoPathOrFeedback === "string" &&
    (videoPathOrFeedback.endsWith(".mp4") ||
      videoPathOrFeedback.includes("/") ||
      videoPathOrFeedback.includes("\\"));

  if (isVideo) {
    videoPath = videoPathOrFeedback;
    reAskFeedback = reAskFeedbackOrReviewJson;
    deterministicReviewJson = deterministicReviewJsonOrFacts;
  } else {
    reAskFeedback = videoPathOrFeedback;
    deterministicReviewJson = reAskFeedbackOrReviewJson;
    factsText = deterministicReviewJsonOrFacts;
  }

  const criteriaText = RUBRIC_CRITERIA.map(
    (c, i) => `${i + 1}. [${c.isGate ? "HARD GATE" : "CRITERION"}] ${c.title} (key: "${c.name}"):\n` +
      `   Requirement: ${c.description}\n` +
      `   Pass Target: ${c.passTarget}`,
  ).join("\n\n");

  const reAskNote = reAskFeedback
    ? `\n\nCRITICAL PREVIOUS ERROR: Your previous response was rejected because the following criteria lacked timestamp evidence:\n${reAskFeedback}\nYou MUST provide specific timestamps (e.g. "0:14", "0:32-0:38") for EVERY single criterion in the evidenceTimestamps array and reason text.\n`
    : "";

  const deterministicNote = deterministicReviewJson
    ? `\n\nPRE-MEASURED DETERMINISTIC REVIEW FACTS:\nA deterministic quality check was performed prior to this review:\n${deterministicReviewJson}\nFactor these measured facts into your evaluation of layout persistence, captions, safe-area bounds, and audio sync.\n`
    : "";

  const factsNote = factsText
    ? `\n\n${factsText}\n`
    : "";

  const videoDirective = videoPath
    ? `Watch and inspect the complete local video file at: ${videoPath} with audio.`
    : `Watch the complete video carefully with audio.`;

  return `You are an expert video director and technical judge reviewing an animated explainer video.
${videoDirective} Evaluate it decisively against the following 12 quality criteria:

${criteriaText}

SCORING AND VERDICT RULES:
1. Provide an overall score out of 10.0 (decimals allowed, e.g. 7.5, 9.2).
2. For EACH of the 12 criteria, provide:
   - "name": the exact criterion key (e.g. "persistent_stage")
   - "title": human-readable title
   - "isGate": boolean (true for the 6 hard gates: persistent_stage, camera_purpose, bottom_captions, readability, no_overlap_clipping, audio_sync)
   - "score": score from 0.0 to 10.0
   - "passed": boolean (true if meets the pass target, false if defective)
   - "evidenceTimestamps": array of timestamps (e.g. ["0:04", "0:25-0:31"]) citing exactly where in the video you observed this behavior. YOU MUST PROVIDE REAL TIMESTAMPS FOR EVERY CRITERION.
   - "reason": concise explanation citing what occurs at those timestamps.
3. Verdict rule:
   - If overallScore >= 9.0 AND all 6 hard gates passed (isGate=true criteria have passed=true and score >= 6.0), the verdict is "ACCEPT".
   - Otherwise, the verdict is "REVISE". Be strict, objective, and decisive.
4. Provide prioritized, constructive, and concrete feedback in "feedback":
   - For each issue, specify priority ("high", "medium", "low"), approximate timestamp, the specific issue observed, and the concrete recommended action for the AI animator/agent.
${factsNote}${deterministicNote}${reAskNote}
Return ONLY valid JSON matching this schema:
{
  "overallScore": number,
  "verdict": "ACCEPT" | "REVISE",
  "summary": string,
  "criteria": [
    {
      "name": string,
      "title": string,
      "isGate": boolean,
      "score": number,
      "passed": boolean,
      "evidenceTimestamps": string[],
      "reason": string
    }
  ],
  "feedback": [
    {
      "priority": "high" | "medium" | "low",
      "timestamp": string,
      "issue": string,
      "recommendation": string
    }
  ]
}`;
}

// Builds the pairwise comparison prompt for two videos.
export function buildPairwiseReviewPrompt(
  video1OrTopic?: string,
  video2Path?: string,
  topic?: string,
): string {
  let video1: string | undefined;
  let video2: string | undefined;
  let topicStr: string | undefined;

  if (video2Path) {
    video1 = video1OrTopic;
    video2 = video2Path;
    topicStr = topic;
  } else {
    topicStr = video1OrTopic;
  }

  const topicContext = topicStr ? ` on the topic of "${topicStr}"` : "";
  const locationContext = (video1 && video2)
    ? `\nVideo 1 is located at: ${video1}\nVideo 2 is located at: ${video2}\nWatch and inspect both complete local video files carefully with audio.\n`
    : `\nWatch both videos fully with audio.\n`;

  return `You are judging two technical explainer videos${topicContext}. Both were created for the same brief: 16:9, narrated, animated technical diagrams. ${locationContext}
Evaluation Guidance based on the Aideos Good-Video Rubric:
1. Unified Persistent Stage: A single continuous stage where diagrams and text evolve together is strictly preferred over layout splitting (e.g. a separate left text column isolates text from graphics and violates the single stage principle).
2. Carry-over and Transformation: Elements should persist and visibly transform across beats rather than being wiped clean.
3. Purposeful Camera Motion: Cinematic framing changes (slow zooms, tilts, payoff pans) that guide viewer attention are preferred over static framing.
4. Captions and Readability: Burned-in bottom subtitles synchronized to voiceover ensure accessibility, whereas uncaptioned video or cramped secondary monospace labels fail the readability gate.
5. Audio Sync and Mix: Visual cues landing within 120ms of spoken words and clear voiceover mixed to -14 to -18 LUFS.

Carefully evaluate "Video 1" and "Video 2":
- For EACH video give:
  - An overall rating out of 10.0
  - Scores and concise reasoning referencing specific moments with timestamps.
- Then CHOOSE ONE video you would rather watch and recommend ("Video 1", "Video 2", or "Tie").
- Explain your decision with concrete sentences referencing specific moments with timestamps in both videos.

Return ONLY valid JSON with this schema:
{
  "video1Score": number,
  "video2Score": number,
  "choice": "Video 1" | "Video 2" | "Tie",
  "reasoning": string,
  "timestampsCited": string[]
}`;
}

export const SINGLE_REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    overallScore: { type: "number" },
    verdict: { type: "string", enum: ["ACCEPT", "REVISE"] },
    summary: { type: "string" },
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          isGate: { type: "boolean" },
          score: { type: "number" },
          passed: { type: "boolean" },
          evidenceTimestamps: {
            type: "array",
            items: { type: "string" },
          },
          reason: { type: "string" },
        },
        required: [
          "name",
          "title",
          "isGate",
          "score",
          "passed",
          "evidenceTimestamps",
          "reason",
        ],
      },
    },
    feedback: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["high", "medium", "low"] },
          timestamp: { type: "string" },
          issue: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["priority", "issue", "recommendation"],
      },
    },
  },
  required: ["overallScore", "verdict", "summary", "criteria", "feedback"],
};

export const PAIRWISE_REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    video1Score: { type: "number" },
    video2Score: { type: "number" },
    choice: { type: "string", enum: ["Video 1", "Video 2", "Tie"] },
    reasoning: { type: "string" },
    timestampsCited: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["video1Score", "video2Score", "choice", "reasoning"],
};
