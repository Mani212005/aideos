/**
 * File Description: The prompt rules of the illustrated stage's pictures. Every prompt is the film's one style paragraph, then the object's own prompt, then the fixed rules (no text of any kind, abstract objects only, no people, no logos, no named brands or artists, a plain or transparent background for an object). `promptProblems` flags an object prompt or style paragraph that asks for what the rules forbid (people, faces, logos, brands, named artists or styles, text, a picture per scene), so the design check can refuse it before any request is made. These are word checks: the owner still looks at every new object once.
 * Pure (no Node imports), so the design spec schema can read the aspect list.
 * Inputs and outputs: a style paragraph and an object prompt -> the composed prompt text, or the list of rule breaks found.
 * Used by: backend/pictures/cache.ts, backend/designSpec/spec.ts, backend/designCheck/pictures.ts, backend/designSpec/brief.ts.
 */

/** The aspect ratios a picture may be asked for. */
export const PICTURE_ASPECTS = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4"] as const;
export type PictureAspect = (typeof PICTURE_ASPECTS)[number];

/** The fixed rules appended to every picture prompt. */
export const PICTURE_RULES = [
  "Absolutely no text, letters, numbers, labels, signs, captions or watermarks anywhere in the image.",
  "One abstract object only: no people, no faces, no hands, no animals, no characters.",
  "No logos, no brand marks, no real products or trademarks, no recognisable designs of real companies or artists.",
  "Keep the background plain so the object can stand on its own, or transparent when asked.",
].join(" ");

/** The prompt a generator is given: the style paragraph, the object's prompt, then the fixed rules. */
export function composePicturePrompt(style: string, objectPrompt: string): string {
  return `${style.trim()}\n\n${objectPrompt.trim()}\n\n${PICTURE_RULES}`;
}

/** Word patterns a picture prompt may not use, each with the rule it breaks. */
const FORBIDDEN: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /\b(people|person|persons|man|men|woman|women|boy|girl|child|children|kid|kids|human|humans|crowd|portrait|selfie|face|faces|hands?|fingers?|body|bodies|character|characters|mascot|celebrit(y|ies))\b/i, rule: "no people, faces, hands or characters" },
  { pattern: /\b(logo|logos|logotype|brand|brands|branded|trademark|trademarks|wordmark|emblem of)\b/i, rule: "no logos or brand marks" },
  { pattern: /\b(in the style of|style of|styled after|inspired by|as painted by|by the artist|artstation|greg rutkowski|pixar|disney|ghibli|marvel|google|microsoft|samsung|iphone|signal app|whatsapp|openai|tesla|nike|coca[- ]?cola)\b/i, rule: "no named brands, products, studios or artists" },
  { pattern: /\b(text|caption|captions|label|labels|lettering|letters|words?|typography|headline|title|sign|signs|signage|numbers?|digits?|written|writing|says|spelled|font)\b/i, rule: "no text inside a picture (SVG keeps every word and number)" },
  { pattern: /\b(scene \d+|beat \d+|every (scene|beat|shot)|storyboard|comic panel|slide)\b/i, rule: "no picture per scene: one plate and a few objects stay on the one stage" },
];

/** The words a prompt may use to forbid things ("no text", "without logos") are not rule breaks themselves. */
const NEGATION = /\b(no|without|never|free of|not|avoid|avoiding|zero)\s+(?:\w+\s+){0,3}$/i;

/** Lists each rule a style paragraph or object prompt breaks, quoting the words that break it. */
export function promptProblems(text: string): string[] {
  const problems: string[] = [];
  for (const { pattern, rule } of FORBIDDEN) {
    const global = new RegExp(pattern.source, "gi");
    for (const match of text.matchAll(global)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
      if (NEGATION.test(before)) continue;
      problems.push(`asks for "${match[0]}" (${rule})`);
      break;
    }
  }
  return problems;
}
