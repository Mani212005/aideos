/**
 * File Description: Bespoke Generative SVG Synthesis Engine for Aideos Video Packages.
 * Prompts Gemini to synthesize tailored, theme-harmonized React SVG components for shot visual directions.
 */

import fs from "node:fs";
import path from "node:path";
import { getVideosDir } from "../../src/dl/videoPackageLoader";

export interface SvgGenerationOptions {
  slug: string;
  componentName: string;
  visualDirection: string;
  topic?: string;
  accent?: string;
}

export interface SvgValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Builds the system prompt for generating bespoke React SVG visual components.
 */
export function buildSvgPrompt(options: SvgGenerationOptions): string {
  return `You are the Aideos Generative Motion Graphic Artist.
Your task is to write a clean, self-contained React TypeScript SVG component for an explainer video.

---
### VISUAL DIRECTION SPECIFICATION
- **Component Name**: ${options.componentName}
- **Topic**: ${options.topic || "Technical Explainer"}
- **Visual Scene to Illustrate**: "${options.visualDirection}"
- **Default Accent Color**: ${options.accent || "#635BFF"}

---
### MANDATORY INVARIANT RULES
1. **ViewBox & Aspect Ratio (Rule V-4)**: The root <svg> must declare viewBox="-300 -200 600 400" (or "0 0 600 400") and preserveAspectRatio="xMidYMid meet".
2. **Viewport Centering (Rule V-2)**: Key visual elements must stay within the center 60% of the viewBox coordinates.
3. **Theme Harmonization**: Use semantic theme token hooks:
   - import { useAccent } from "../../../src/dl/accent";
   - const accent = useAccent();
   - Use rgba(255, 255, 255, 0.9) for text, rgba(255, 255, 255, 0.15) for subtle grid/borders.
4. **Animation Timing**: Accept \`{ frame: number }\` prop for smooth Remotion procedural animation (e.g. frame * 0.05).
5. **Clean React Code**: Output ONLY the complete TypeScript React code, wrapped in \`\`\`tsx codeblock.

Write the complete React component now:`;
}

/**
 * Validates generated React SVG code against geometric and schema invariants.
 */
export function validateGeneratedSvg(code: string): SvgValidationResult {
  const errors: string[] = [];

  if (!code || typeof code !== "string") {
    return { valid: false, errors: ["Empty or non-string code generated."] };
  }

  // 1. Check for <svg> root element
  if (!code.includes("<svg")) {
    errors.push("Missing root <svg> element in component.");
  }

  // 2. Check for viewBox (Rule V-4)
  if (!/viewBox\s*=\s*/.test(code)) {
    errors.push("Invariant V-4 Violation: <svg> must declare explicit viewBox attribute.");
  }

  // 3. Check for preserveAspectRatio (Rule V-4)
  if (!/preserveAspectRatio\s*=\s*(?:["']xMidYMid meet["']|\{\s*["'`]xMidYMid meet["'`]\s*\})/.test(code)) {
    errors.push("Invariant V-4 Violation: <svg> must declare preserveAspectRatio=\"xMidYMid meet\".");
  }

  // 4. Check for React export
  if (!/export\s+(?:const|function|default|let|var|\{)/.test(code)) {
    errors.push("Component must be exported from module.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Cleans markdown code fences from LLM generated code.
 */
export function cleanCodeFence(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```tsx")) {
    cleaned = cleaned.replace(/^```tsx\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```typescript")) {
    cleaned = cleaned.replace(/^```typescript\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

/**
 * Synthesizes and writes a bespoke SVG component into a video package's visuals directory.
 */
export async function synthesizeBespokeSvg(
  options: SvgGenerationOptions,
  llmCaller: (prompt: string) => Promise<string>,
  targetDir?: string
): Promise<{ success: boolean; filePath?: string; errors?: string[] }> {
  const prompt = buildSvgPrompt(options);
  const rawResponse = await llmCaller(prompt);
  const cleanedCode = cleanCodeFence(rawResponse);

  const validation = validateGeneratedSvg(cleanedCode);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const baseDir = targetDir || path.resolve(getVideosDir(), options.slug, "visuals");
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const filePath = path.join(baseDir, `${options.componentName}.tsx`);
  fs.writeFileSync(filePath, cleanedCode, "utf8");

  return { success: true, filePath };
}
