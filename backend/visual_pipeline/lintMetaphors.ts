/**
 * File Description: Lint check asserting zero hardcoded topic-specific text or labels
 * exist in metaphor and device component source files (Rule M1).
 */
import fs from "fs";
import path from "path";

export const FORBIDDEN_HARDCODED_LABELS = [
  "Compute Cost",
  "VRAM Bandwidth",
  "Precision Trade-Off Equilibrium",
  "Single-Pass Prefill",
  "Yann LeCun Stamp",
  "yann_lecun_quote.txt",
];

export function lintMetaphorSourceFiles(metaphorsDir?: string): { clean: boolean; violations: string[] } {
  const targetDir = metaphorsDir ?? path.resolve(process.cwd(), "src/dl/metaphors");
  const violations: string[] = [];
  if (!fs.existsSync(targetDir)) {
    return { clean: true, violations };
  }

  const files = fs.readdirSync(targetDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  for (const file of files) {
    const fullPath = path.join(targetDir, file);
    const content = fs.readFileSync(fullPath, "utf-8");

    for (const forbidden of FORBIDDEN_HARDCODED_LABELS) {
      if (content.includes(forbidden)) {
        violations.push(`File "${file}" contains hardcoded topic-specific string: "${forbidden}"`);
      }
    }
  }

  return { clean: violations.length === 0, violations };
}
