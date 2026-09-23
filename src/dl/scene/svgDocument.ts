/**
 * File Description: Pure, dependency-free SVG document parser for the Aideos scene engine.
 * Turns an SVG source string into a typed, serializable element tree so that the renderer can
 * address individual elements by id, apply per-frame animated state to them, and keep element
 * identity stable between frames. Has zero Node runtime imports so it runs in Remotion's browser
 * bundle and in Node tests alike.
 */

/** A single parsed SVG element: tag name, attributes, text content and children. */
export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
  /** Literal text content, present only for text-bearing tags such as <text> and <tspan>. */
  text?: string;
}

/** A parsed SVG document: the root <svg> attributes plus its child element tree. */
export interface SvgDocument {
  viewBox: string | null;
  width: string | null;
  height: string | null;
  preserveAspectRatio: string | null;
  rootAttrs: Record<string, string>;
  children: SvgNode[];
}

/** Raised when an SVG source string cannot be parsed into a well-formed element tree. */
export class SvgParseError extends Error {
  constructor(message: string) {
    super(`SVG_PARSE_ERROR: ${message}`);
    this.name = "SvgParseError";
  }
}

/** SVG tags that never have children and may be written without a closing tag. */
const VOID_TAGS = new Set([
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
  "animate",
  "animateTransform",
  "animateMotion",
  "feGaussianBlur",
  "feOffset",
  "feFlood",
  "feComposite",
  "feBlend",
  "feColorMatrix",
  "feMergeNode",
]);

/** Tags whose literal character content is meaningful and must survive the round trip. */
const TEXT_TAGS = new Set(["text", "tspan", "textPath", "title", "desc", "style"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decodes the XML entity references that can legally appear in SVG attribute values and text. */
function decodeEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? match : named;
  });
}

/** Escapes a string so it is safe to emit inside an XML attribute value. */
export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escapes a string so it is safe to emit as XML character data. */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Parses the attribute section of a start tag into a plain attribute record. */
function parseAttributes(source: string, tagName: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_:][-.\w:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(source)) !== null) {
    const name = match[1];
    const value = match[2] !== undefined ? match[2] : (match[3] ?? "");
    attrs[name] = decodeEntities(value);
  }

  // A bare attribute with no value (valid in HTML, never in SVG/XML) is a parse failure rather
  // than something to silently drop, because dropping it would change how the asset renders.
  const withoutPairs = source.replace(attrRegex, " ");
  const stray = withoutPairs.match(/[^\s/]+/);
  if (stray) {
    throw new SvgParseError(
      `Malformed attribute "${stray[0]}" on <${tagName}>: every SVG attribute must be written as name="value".`,
    );
  }

  return attrs;
}

/** Parses an SVG source string into a typed document tree, throwing on malformed markup. */
export function parseSvgDocument(source: string): SvgDocument {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new SvgParseError("Source is empty.");
  }

  // Strip comments, XML declarations, doctypes and CDATA wrappers before tokenising.
  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, body: string) => body);

  const rootStart = cleaned.search(/<svg[\s>]/i);
  if (rootStart === -1) {
    throw new SvgParseError("No root <svg> element found.");
  }

  const tagRegex = /<\s*(\/)?\s*([A-Za-z_:][-.\w:]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?>/g;
  tagRegex.lastIndex = rootStart;

  const stack: SvgNode[] = [];
  let root: SvgNode | null = null;
  let match: RegExpExecArray | null;
  let lastIndex = rootStart;

  while ((match = tagRegex.exec(cleaned)) !== null) {
    const isClosing = Boolean(match[1]);
    const tagName = match[2];
    const attrSource = match[3] ?? "";
    const selfClosing = Boolean(match[4]);

    // Capture character data that sits between the previous tag and this one.
    const between = cleaned.slice(lastIndex, match.index);
    lastIndex = tagRegex.lastIndex;
    const parent = stack[stack.length - 1];
    if (parent && TEXT_TAGS.has(parent.tag)) {
      const textChunk = decodeEntities(between);
      if (textChunk.trim().length > 0) {
        parent.text = (parent.text ?? "") + textChunk;
      }
    }

    if (isClosing) {
      const open = stack.pop();
      if (!open) {
        throw new SvgParseError(`Unexpected closing tag </${tagName}> with no matching open tag.`);
      }
      if (open.tag !== tagName) {
        throw new SvgParseError(
          `Mismatched closing tag: <${open.tag}> is closed by </${tagName}>.`,
        );
      }
      if (stack.length === 0) break;
      continue;
    }

    const node: SvgNode = {
      tag: tagName,
      attrs: parseAttributes(attrSource, tagName),
      children: [],
    };

    if (stack.length === 0) {
      if (tagName !== "svg") {
        throw new SvgParseError(`Root element must be <svg>, found <${tagName}>.`);
      }
      root = node;
    } else {
      stack[stack.length - 1].children.push(node);
    }

    if (!selfClosing) {
      stack.push(node);
    }
  }

  if (!root) {
    throw new SvgParseError("No root <svg> element found.");
  }
  if (stack.length > 0) {
    throw new SvgParseError(
      `Unclosed element(s): ${stack.map((n) => `<${n.tag}>`).join(", ")}.`,
    );
  }

  return {
    viewBox: root.attrs.viewBox ?? null,
    width: root.attrs.width ?? null,
    height: root.attrs.height ?? null,
    preserveAspectRatio: root.attrs.preserveAspectRatio ?? null,
    rootAttrs: root.attrs,
    children: root.children,
  };
}

/** Walks every node in a document tree in document order, calling visit on each. */
export function walkSvgNodes(doc: SvgDocument, visit: (node: SvgNode, depth: number) => void): void {
  const recurse = (nodes: SvgNode[], depth: number) => {
    for (const node of nodes) {
      visit(node, depth);
      recurse(node.children, depth + 1);
    }
  };
  recurse(doc.children, 0);
}

/** Collects every id attribute declared anywhere in the document, in document order. */
export function collectSvgElementIds(doc: SvgDocument): string[] {
  const ids: string[] = [];
  walkSvgNodes(doc, (node) => {
    const id = node.attrs.id;
    if (id) ids.push(id);
  });
  return ids;
}

/** Finds the first node carrying the given id attribute, or null when nothing matches. */
export function findSvgNodeById(doc: SvgDocument, id: string): SvgNode | null {
  let found: SvgNode | null = null;
  walkSvgNodes(doc, (node) => {
    if (!found && node.attrs.id === id) found = node;
  });
  return found;
}

/** Reads the four numbers of a viewBox attribute, or null when it is absent or malformed. */
export function parseViewBox(
  viewBox: string | null,
): { minX: number; minY: number; width: number; height: number } | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts[2] <= 0 || parts[3] <= 0) return null;
  return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
}

/** Serializes a parsed document tree back to an SVG string, preserving attribute order. */
export function serializeSvgDocument(doc: SvgDocument): string {
  const serializeNode = (node: SvgNode): string => {
    const attrs = Object.entries(node.attrs)
      .map(([k, v]) => ` ${k}="${escapeXmlAttribute(v)}"`)
      .join("");
    const inner =
      (node.text ? escapeXmlText(node.text) : "") + node.children.map(serializeNode).join("");
    if (inner.length === 0 && VOID_TAGS.has(node.tag)) {
      return `<${node.tag}${attrs}/>`;
    }
    return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
  };

  const rootAttrs = Object.entries(doc.rootAttrs)
    .map(([k, v]) => ` ${k}="${escapeXmlAttribute(v)}"`)
    .join("");
  return `<svg${rootAttrs}>${doc.children.map(serializeNode).join("")}</svg>`;
}
