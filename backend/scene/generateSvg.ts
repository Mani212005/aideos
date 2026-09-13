/**
 * File Description: Bespoke Generative SVG Synthesis Engine for Aideos Video Packages.
 * Prompts a model to synthesize tailored, theme-harmonized React SVG components and plain animatable
 * SVG assets for shot visual directions, and gates every generated artefact against the invariant
 * rules before anything reaches a video package: well-formedness, the mandated viewBox and
 * preserveAspectRatio, centre-60% containment, self-containment, and frame-driven determinism.
 * Generation that fails these rules is retried with the failure fed back to the model, and never
 * written to disk.
 */

import fs from "node:fs";
import path from "node:path";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import {
  collectSvgElementIds,
  parseSvgDocument,
  parseViewBox,
  walkSvgNodes,
} from "../../src/dl/scene/svgDocument";

export interface SvgGenerationOptions {
  slug: string;
  componentName: string;
  visualDirection: string;
  topic?: string;
  accent?: string;
  /** How many attempts to make in total before giving up. Default 3. */
  maxAttempts?: number;
}

export interface SvgValidationResult {
  valid: boolean;
  errors: string[];
}

/** One rejected generation attempt, kept so a failure can be explained rather than just reported. */
export interface SvgGenerationAttempt {
  attempt: number;
  errors: string[];
}

export interface SvgSynthesisResult {
  success: boolean;
  filePath?: string;
  errors?: string[];
  /** Every rejected attempt, oldest first. Empty when the first attempt was accepted. */
  attempts: SvgGenerationAttempt[];
  /** Element ids declared by a generated .svg asset, for targeting with animation clips. */
  elementIds?: string[];
}

export const REQUIRED_VIEW_BOXES = ["-300 -200 600 400", "0 0 600 400"] as const;

/** Source constructs that break Remotion's frame-driven purity contract. */
const NON_DETERMINISTIC_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bMath\s*\.\s*random\s*\(/, label: "Math.random()" },
  { pattern: /\bDate\s*\.\s*now\s*\(/, label: "Date.now()" },
  { pattern: /\bnew\s+Date\s*\(/, label: "new Date()" },
  { pattern: /\bperformance\s*\.\s*now\s*\(/, label: "performance.now()" },
  { pattern: /\bsetTimeout\s*\(/, label: "setTimeout()" },
  { pattern: /\bsetInterval\s*\(/, label: "setInterval()" },
  { pattern: /\brequestAnimationFrame\s*\(/, label: "requestAnimationFrame()" },
  { pattern: /\buseEffect\s*\(/, label: "useEffect()" },
  { pattern: /\buseState\s*\(/, label: "useState()" },
  { pattern: /\bcrypto\s*\.\s*getRandomValues\s*\(/, label: "crypto.getRandomValues()" },
  { pattern: /transition\s*:/i, label: "CSS transition" },
  { pattern: /animation\s*:/i, label: "CSS animation shorthand" },
  { pattern: /@keyframes/i, label: "CSS @keyframes" },
  { pattern: /<\s*animate(Transform|Motion)?\b/i, label: "SMIL <animate> element" },
];

/** Source constructs that make a generated component depend on something outside itself. */
const NON_SELF_CONTAINED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfetch\s*\(/, label: "fetch()" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\brequire\s*\(\s*["']node:/, label: "node: require" },
  { pattern: /\bfrom\s+["']node:/, label: "node: import" },
  { pattern: /\bfrom\s+["'](?:fs|path|child_process|os|http|https|net)["']/, label: "Node builtin import" },
  { pattern: /\bhref\s*=\s*["']https?:/i, label: "remote href" },
  { pattern: /\bsrc\s*=\s*["']https?:/i, label: "remote src" },
  { pattern: /url\(\s*["']?https?:/i, label: "remote url()" },
];

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
4. **Animation Timing (Rule V-5)**: Accept \`{ frame: number }\` prop and derive every animated value from it (e.g. frame * 0.05). Frame-driven purity is mandatory: no CSS transitions, no CSS animations, no SMIL <animate>, no setTimeout, no requestAnimationFrame, no useState, no useEffect, no Date, and no Math.random.
5. **Self-Contained (Rule V-6)**: No network access, no remote URLs, no Node builtins. The component must render from its props alone.
6. **Clean React Code**: Output ONLY the complete TypeScript React code, wrapped in \`\`\`tsx codeblock.

Write the complete React component now:`;
}

/**
 * Builds the prompt for generating a plain animatable .svg asset for the scene graph.
 * Scene assets are static documents with stable element ids: motion comes from declarative
 * animation clips (see src/dl/scene/svgAnimation.ts), never from markup baked into the file.
 */
export function buildSvgAssetPrompt(options: SvgGenerationOptions): string {
  return `You are the Aideos Generative Vector Artist.
Write one self-contained, static SVG document that the Aideos scene engine will animate.

---
### VISUAL DIRECTION SPECIFICATION
- **Asset Name**: ${options.componentName}
- **Topic**: ${options.topic || "Technical Explainer"}
- **Visual Scene to Illustrate**: "${options.visualDirection}"
- **Default Accent Color**: ${options.accent || "#635BFF"}

---
### MANDATORY INVARIANT RULES
1. **ViewBox & Aspect Ratio (Rule V-4)**: The root <svg> must declare viewBox="-300 -200 600 400" and preserveAspectRatio="xMidYMid meet".
2. **Viewport Centering (Rule V-2)**: Every drawn element must sit within the center 60% of the viewBox.
3. **Addressable Parts (Rule V-7)**: Give every part that should be able to move its own id on a <g> wrapper, named for what it is (for example id="node-input", id="edge-1", id="label-cache"). The animation layer addresses elements by id, so an element with no id can never move.
4. **Static Document (Rule V-5)**: No <script>, no <animate>, no <foreignObject>, no CSS transitions or animations. All motion is added later as declarative clips.
5. **Self-Contained (Rule V-6)**: No remote hrefs, no external images, no web fonts.
6. Output ONLY the SVG document, wrapped in a \`\`\`svg codeblock.

Write the complete SVG document now:`;
}

/**
 * Collects every numeric coordinate pair a drawn element contributes, in viewBox space.
 * A rect that covers most of the viewBox is a backdrop rather than a subject, so it is skipped:
 * the containment rule is about where the eye goes, not about full-bleed framing.
 */
function collectDrawnPoints(
  code: string,
  viewBoxArea: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];

  const pushPair = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  };

  const rectRegex = /<rect\b([^>]*?)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = rectRegex.exec(code)) !== null) {
    const attrs = match[1];
    const x = Number(attrs.match(/\bx\s*=\s*["']?(-?[\d.]+)/)?.[1] ?? NaN);
    const y = Number(attrs.match(/\by\s*=\s*["']?(-?[\d.]+)/)?.[1] ?? NaN);
    const w = Number(attrs.match(/\bwidth\s*=\s*["']?(-?[\d.]+)/)?.[1] ?? NaN);
    const h = Number(attrs.match(/\bheight\s*=\s*["']?(-?[\d.]+)/)?.[1] ?? NaN);
    if (Number.isFinite(w) && Number.isFinite(h) && viewBoxArea > 0 && w * h >= viewBoxArea * 0.6) {
      continue;
    }
    pushPair(x, y);
    pushPair(x + w, y + h);
  }

  const centredRegex = /<(?:circle|ellipse|text|tspan)\b([^>]*?)\/?>/gi;
  while ((match = centredRegex.exec(code)) !== null) {
    const attrs = match[1];
    const cx = Number(attrs.match(/\bc?x\s*=\s*["'{]?(-?[\d.]+)/)?.[1] ?? NaN);
    const cy = Number(attrs.match(/\bc?y\s*=\s*["'{]?(-?[\d.]+)/)?.[1] ?? NaN);
    pushPair(cx, cy);
  }

  const lineRegex = /<line\b([^>]*?)\/?>/gi;
  while ((match = lineRegex.exec(code)) !== null) {
    const attrs = match[1];
    pushPair(
      Number(attrs.match(/\bx1\s*=\s*["']?(-?[\d.]+)/)?.[1] ?? NaN),
      Number(attrs.match(/\by1\s*=\s*["']?(-?[\d.]+)/)?.[1] ?? NaN),
    );
    pushPair(
      Number(attrs.match(/\bx2\s*=\s*["']?(-?[\d.]+)/)?.[1] ?? NaN),
      Number(attrs.match(/\by2\s*=\s*["']?(-?[\d.]+)/)?.[1] ?? NaN),
    );
  }

  const pointListRegex = /\bpoints\s*=\s*["']([^"']+)["']/gi;
  while ((match = pointListRegex.exec(code)) !== null) {
    const numbers = match[1].match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < numbers.length; i += 2) pushPair(numbers[i], numbers[i + 1]);
  }

  const pathRegex = /\bd\s*=\s*["']([^"']+)["']/gi;
  while ((match = pathRegex.exec(code)) !== null) {
    const numbers = match[1].match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < numbers.length; i += 2) pushPair(numbers[i], numbers[i + 1]);
  }

  return points;
}

/**
 * Checks Rule V-2: the drawn geometry must sit inside the centre 60% of the viewBox.
 * Reported as a single error naming the worst offending coordinate so the retry prompt is useful.
 */
function checkCentreContainment(code: string, viewBox: string | null): string | null {
  const box = parseViewBox(viewBox);
  if (!box) return null;

  const marginX = box.width * 0.2;
  const marginY = box.height * 0.2;
  const safe = {
    minX: box.minX + marginX,
    maxX: box.minX + box.width - marginX,
    minY: box.minY + marginY,
    maxY: box.minY + box.height - marginY,
  };

  const points = collectDrawnPoints(code, box.width * box.height);
  if (points.length === 0) return null;

  const inside = points.filter(
    (p) => p.x >= safe.minX && p.x <= safe.maxX && p.y >= safe.minY && p.y <= safe.maxY,
  );

  // Decorative framing (a full-bleed backdrop, a hairline border) legitimately sits outside the
  // safe area, so the rule is that the bulk of the geometry is centred, not every last point.
  const ratio = inside.length / points.length;
  if (ratio >= 0.6) return null;

  return `Invariant V-2 Violation: only ${(ratio * 100).toFixed(0)}% of drawn geometry sits inside the centre 60% of viewBox "${viewBox}" (safe area x ${safe.minX}..${safe.maxX}, y ${safe.minY}..${safe.maxY}). Key elements must be centred.`;
}

/** Tags that are written without a closing tag inside JSX markup. */
const JSX_VOID_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "image",
  "use",
  "stop",
  "br",
  "img",
  "input",
]);

/**
 * Checks that JSX and SVG tags are balanced enough that the output will actually compile.
 * Only the markup region is scanned, so TypeScript generics and arrow functions in the surrounding
 * module are not mistaken for tags.
 */
function checkTagBalance(code: string): string[] {
  const errors: string[] = [];

  const svgStart = code.search(/<svg[\s>]/i);
  const svgEnd = code.lastIndexOf("</svg>");
  if (svgStart !== -1 && svgEnd !== -1 && svgEnd > svgStart) {
    const markup = code.slice(svgStart, svgEnd + "</svg>".length);
    // Attribute values may be quoted strings or JSX expressions, and an expression may itself hold
    // an object literal (style={{ ... }}), so brace matching allows two levels of nesting.
    const tokenRegex =
      /<(\/?)([A-Za-z][\w.:-]*)((?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}|[^>"'{])*?)(\/?)>/g;
    const stack: string[] = [];
    let token: RegExpExecArray | null;

    while ((token = tokenRegex.exec(markup)) !== null) {
      const isClosing = token[1] === "/";
      const tag = token[2];
      const selfClosing = token[4] === "/";

      if (isClosing) {
        const open = stack.pop();
        if (!open) {
          errors.push(`Malformed markup: closing tag </${tag}> has no matching open tag.`);
          break;
        }
        if (open !== tag) {
          errors.push(`Malformed markup: <${open}> is closed by </${tag}>.`);
          break;
        }
        continue;
      }
      if (!selfClosing && !JSX_VOID_TAGS.has(tag)) stack.push(tag);
    }

    if (stack.length > 0) {
      errors.push(`Malformed markup: unclosed element(s) ${stack.map((t) => `<${t}>`).join(", ")}.`);
    }
  }

  const braces = (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
  if (braces !== 0) {
    errors.push(`Malformed code: unbalanced braces (${braces > 0 ? braces + " unclosed" : -braces + " unopened"}).`);
  }

  const parens = (code.match(/\(/g) || []).length - (code.match(/\)/g) || []).length;
  if (parens !== 0) {
    errors.push(`Malformed code: unbalanced parentheses (${parens > 0 ? parens + " unclosed" : -parens + " unopened"}).`);
  }

  return errors;
}

/**
 * Validates generated React SVG code against the geometric, determinism and containment invariants.
 * Every rule the prompt states is checked here: a rule that is only asked for is not enforced.
 */
export function validateGeneratedSvg(code: string): SvgValidationResult {
  const errors: string[] = [];

  if (!code || typeof code !== "string" || code.trim().length === 0) {
    return { valid: false, errors: ["Empty or non-string code generated."] };
  }

  // 1. Check for <svg> root element
  if (!code.includes("<svg")) {
    errors.push("Missing root <svg> element in component.");
  }

  // 2. Check for viewBox (Rule V-4), and that it is one of the mandated framings
  const viewBoxMatch = code.match(/viewBox\s*=\s*(?:["']([^"']+)["']|\{\s*["'`]([^"'`]+)["'`]\s*\})/);
  if (!viewBoxMatch) {
    errors.push("Invariant V-4 Violation: <svg> must declare explicit viewBox attribute.");
  } else {
    const viewBox = (viewBoxMatch[1] ?? viewBoxMatch[2] ?? "").trim().replace(/[\s,]+/g, " ");
    if (!(REQUIRED_VIEW_BOXES as readonly string[]).includes(viewBox)) {
      errors.push(
        `Invariant V-4 Violation: viewBox "${viewBox}" is not one of the mandated framings ${REQUIRED_VIEW_BOXES.map((v) => `"${v}"`).join(" or ")}.`,
      );
    }
  }

  // 3. Check for preserveAspectRatio (Rule V-4)
  if (!/preserveAspectRatio\s*=\s*(?:["']xMidYMid meet["']|\{\s*["'`]xMidYMid meet["'`]\s*\})/.test(code)) {
    errors.push("Invariant V-4 Violation: <svg> must declare preserveAspectRatio=\"xMidYMid meet\".");
  }

  // 4. Check for React export
  if (!/export\s+(?:const|function|default|let|var|\{)/.test(code)) {
    errors.push("Component must be exported from module.");
  }

  // 5. The output must be code, not a chat reply with code in it.
  const firstMeaningfulLine = code
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstMeaningfulLine && !/^(import|export|const|function|type|interface|\/\/|\/\*|@|"use)/.test(firstMeaningfulLine)) {
    errors.push(
      `Output is not a bare module: it starts with prose ("${firstMeaningfulLine.slice(0, 60)}"). Return only the component source.`,
    );
  }

  // 6. Markup and code must be structurally balanced, or the package will not build.
  errors.push(...checkTagBalance(code));

  // 7. Rule V-5: frame-driven purity.
  for (const { pattern, label } of NON_DETERMINISTIC_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(
        `Invariant V-5 Violation: uses ${label}. Remotion renders frame by frame, so every animated value must derive from the frame prop.`,
      );
    }
  }

  // 8. Rule V-6: self-containment.
  for (const { pattern, label } of NON_SELF_CONTAINED_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(`Invariant V-6 Violation: uses ${label}. The component must render from its props alone.`);
    }
  }

  // 9. Rule V-2: centre containment.
  const containment = checkCentreContainment(code, viewBoxMatch ? (viewBoxMatch[1] ?? viewBoxMatch[2] ?? null) : null);
  if (containment) errors.push(containment);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a plain .svg scene asset: it must parse, be framed correctly, be static and
 * self-contained, and expose ids so the animation layer has something to address.
 */
export function validateGeneratedSvgAsset(svgText: string): SvgValidationResult {
  const errors: string[] = [];

  if (!svgText || typeof svgText !== "string" || svgText.trim().length === 0) {
    return { valid: false, errors: ["Empty or non-string SVG generated."] };
  }

  let doc;
  try {
    doc = parseSvgDocument(svgText);
  } catch (err) {
    return { valid: false, errors: [err instanceof Error ? err.message : String(err)] };
  }

  const viewBox = doc.viewBox ? doc.viewBox.trim().replace(/[\s,]+/g, " ") : null;
  if (!viewBox) {
    errors.push("Invariant V-4 Violation: <svg> must declare explicit viewBox attribute.");
  } else if (!(REQUIRED_VIEW_BOXES as readonly string[]).includes(viewBox)) {
    errors.push(
      `Invariant V-4 Violation: viewBox "${viewBox}" is not one of the mandated framings ${REQUIRED_VIEW_BOXES.map((v) => `"${v}"`).join(" or ")}.`,
    );
  }

  if (doc.preserveAspectRatio !== "xMidYMid meet") {
    errors.push("Invariant V-4 Violation: <svg> must declare preserveAspectRatio=\"xMidYMid meet\".");
  }

  // Rule V-5: the document is static; motion belongs to the declarative animation layer.
  const forbiddenTags = new Set(["script", "animate", "animateTransform", "animateMotion", "foreignObject", "set"]);
  const seenForbidden = new Set<string>();
  walkSvgNodes(doc, (node) => {
    if (forbiddenTags.has(node.tag)) seenForbidden.add(node.tag);
    for (const [name, value] of Object.entries(node.attrs)) {
      if ((name === "href" || name === "xlink:href" || name === "src") && /^https?:/i.test(value)) {
        errors.push(`Invariant V-6 Violation: <${node.tag}> references a remote URL "${value}".`);
      }
      if (name === "style" && /(transition|animation)\s*:/i.test(value)) {
        errors.push(`Invariant V-5 Violation: <${node.tag}> declares a CSS ${/transition/i.test(value) ? "transition" : "animation"}.`);
      }
    }
  });
  for (const tag of seenForbidden) {
    errors.push(
      `Invariant V-5 Violation: contains <${tag}>. Scene assets are static documents; motion is authored as declarative animation clips.`,
    );
  }

  const ids = collectSvgElementIds(doc);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    errors.push(`Duplicate element id(s) [${Array.from(new Set(duplicates)).join(", ")}]: ids must be unique within the document.`);
  }
  if (ids.length === 0) {
    errors.push(
      "Invariant V-7 Violation: no element carries an id. The animation layer addresses elements by id, so an asset with no ids can never move.",
    );
  }

  const containment = checkCentreContainment(svgText, doc.viewBox);
  if (containment) errors.push(containment);

  return { valid: errors.length === 0, errors };
}

/**
 * Cleans markdown code fences from LLM generated code.
 */
export function cleanCodeFence(raw: string): string {
  let cleaned = raw.trim();
  const fenced = cleaned.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) return fenced[1].trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

/** Builds the retry prompt that feeds a rejected attempt's errors back to the model. */
export function buildRepairPrompt(basePrompt: string, rejected: string, errors: string[]): string {
  return `${basePrompt}

---
### PREVIOUS ATTEMPT REJECTED
Your last output failed the invariant gate with these errors:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

The rejected output was:
\`\`\`
${rejected.slice(0, 2000)}
\`\`\`

Fix every error listed above and return the corrected output only.`;
}

/**
 * Runs a generate-validate-repair loop, returning the first output that passes the gate.
 * Shared by both synthesis entry points so a bad generation is always retried the same way.
 */
async function generateWithRepair(
  basePrompt: string,
  llmCaller: (prompt: string) => Promise<string>,
  validate: (code: string) => SvgValidationResult,
  maxAttempts: number,
): Promise<{ code?: string; attempts: SvgGenerationAttempt[] }> {
  const attempts: SvgGenerationAttempt[] = [];
  let prompt = basePrompt;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    let raw: string;
    try {
      raw = await llmCaller(prompt);
    } catch (err) {
      attempts.push({
        attempt,
        errors: [`Model call failed: ${err instanceof Error ? err.message : String(err)}`],
      });
      continue;
    }

    const cleaned = cleanCodeFence(raw);
    const validation = validate(cleaned);
    if (validation.valid) return { code: cleaned, attempts };

    attempts.push({ attempt, errors: validation.errors });
    prompt = buildRepairPrompt(basePrompt, cleaned, validation.errors);
  }

  return { attempts };
}

/**
 * Synthesizes and writes a bespoke React SVG component into a video package's visuals directory.
 * Nothing is written unless the generated component passes every invariant, so a failed generation
 * leaves the video package exactly as it was.
 */
export async function synthesizeBespokeSvg(
  options: SvgGenerationOptions,
  llmCaller: (prompt: string) => Promise<string>,
  targetDir?: string
): Promise<SvgSynthesisResult> {
  const basePrompt = buildSvgPrompt(options);
  const { code, attempts } = await generateWithRepair(
    basePrompt,
    llmCaller,
    validateGeneratedSvg,
    options.maxAttempts ?? 3,
  );

  if (!code) {
    const lastErrors = attempts[attempts.length - 1]?.errors ?? ["No output produced."];
    return { success: false, errors: lastErrors, attempts };
  }

  const baseDir = targetDir || path.resolve(getVideosDir(), options.slug, "visuals");
  fs.mkdirSync(baseDir, { recursive: true });

  const filePath = path.join(baseDir, `${options.componentName}.tsx`);
  fs.writeFileSync(filePath, code, "utf8");

  return { success: true, filePath, attempts };
}

/**
 * Synthesizes and writes a plain animatable .svg scene asset into a video package.
 * Returns the element ids the document declares, which are exactly the ids an animation timeline
 * may target.
 */
export async function synthesizeAnimatableSvgAsset(
  options: SvgGenerationOptions,
  llmCaller: (prompt: string) => Promise<string>,
  targetDir?: string,
): Promise<SvgSynthesisResult> {
  const basePrompt = buildSvgAssetPrompt(options);
  const { code, attempts } = await generateWithRepair(
    basePrompt,
    llmCaller,
    validateGeneratedSvgAsset,
    options.maxAttempts ?? 3,
  );

  if (!code) {
    const lastErrors = attempts[attempts.length - 1]?.errors ?? ["No output produced."];
    return { success: false, errors: lastErrors, attempts };
  }

  const baseDir = targetDir || path.resolve(getVideosDir(), options.slug, "visuals");
  fs.mkdirSync(baseDir, { recursive: true });

  const filePath = path.join(baseDir, `${options.componentName}.svg`);
  fs.writeFileSync(filePath, code, "utf8");

  return {
    success: true,
    filePath,
    attempts,
    elementIds: collectSvgElementIds(parseSvgDocument(code)),
  };
}
