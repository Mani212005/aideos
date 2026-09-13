/**
 * File Description: Converts parsed SVG document trees into React elements for the Aideos renderer.
 * Keeps element identity stable across frames (one React key per document path), namespaces ids and
 * internal references per entity instance, and applies the compiled per-element animation state as
 * plain SVG transform, opacity and stroke-dash attributes. Pure: no Node imports, no DOM access.
 */

import React from "react";
import type { SvgNode } from "./svgDocument";
import type { SvgElementState } from "./svgAnimation";
import { svgElementStateToTransform } from "./svgAnimation";

/** Attribute names that must not be camelCased because they carry their own namespace or prefix. */
const PASSTHROUGH_PREFIXES = ["data-", "aria-"];

/** Attribute names React spells differently from SVG. */
const RENAMED_ATTRS: Record<string, string> = {
  class: "className",
  "xlink:href": "xlinkHref",
  "xlink:title": "xlinkTitle",
  "xml:space": "xmlSpace",
  "xml:lang": "xmlLang",
};

/** Converts a kebab-case SVG attribute name into the camelCase name React expects. */
function toReactAttrName(name: string): string {
  const renamed = RENAMED_ATTRS[name];
  if (renamed) return renamed;
  if (PASSTHROUGH_PREFIXES.some((p) => name.startsWith(p))) return name;
  if (!name.includes("-")) return name;
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** Parses an inline style attribute string into the style object React requires. */
function parseStyleAttribute(style: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const declaration of style.split(";")) {
    const idx = declaration.indexOf(":");
    if (idx === -1) continue;
    const prop = declaration.slice(0, idx).trim();
    const value = declaration.slice(idx + 1).trim();
    if (!prop || !value) continue;
    out[prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
  }
  return out as React.CSSProperties;
}

/** Rewrites a single id so two instances of one asset never collide in the same document. */
function namespaceId(id: string, instanceId: string): string {
  return `${id}--${instanceId}`;
}

/** Attributes whose value may be a bare local reference such as href="#gradient". */
const LOCAL_REFERENCE_ATTRS = new Set(["href", "xlink:href", "begin", "end"]);

/**
 * Rewrites internal references in an attribute value to the namespaced id.
 * url(#x) is rewritten in any attribute; a bare #x only in attributes that take a reference,
 * because a bare # value elsewhere is a colour (fill="#FF6B00"), not a link.
 */
function namespaceReferences(attrName: string, value: string, instanceId: string): string {
  const withUrls = value.replace(
    /url\(\s*#([^)\s]+)\s*\)/g,
    (_m, id: string) => `url(#${namespaceId(id, instanceId)})`,
  );
  if (!LOCAL_REFERENCE_ATTRS.has(attrName)) return withUrls;
  return withUrls.replace(/^#([\w:.-]+)$/, (_m, id: string) => `#${namespaceId(id, instanceId)}`);
}

/** Options controlling how a document subtree is turned into React elements. */
export interface SvgNodeRenderOptions {
  /** Suffix applied to every id and internal reference inside this instance. */
  instanceId: string;
  /** Compiled animation state for this frame, keyed by the element's authored id. */
  elementStates?: Record<string, SvgElementState>;
  /** Stroke length assumed for a drawOn reveal when the element declares no pathLength. */
  defaultPathLength?: number;
}

/** Builds the React props for one SVG node, namespacing ids and applying animation state. */
function buildProps(
  node: SvgNode,
  key: string,
  options: SvgNodeRenderOptions,
): Record<string, unknown> {
  const props: Record<string, unknown> = { key };
  const authoredId = node.attrs.id;

  for (const [name, rawValue] of Object.entries(node.attrs)) {
    if (name === "id") {
      props.id = namespaceId(rawValue, options.instanceId);
      continue;
    }
    if (name === "style") {
      props.style = parseStyleAttribute(rawValue);
      continue;
    }
    props[toReactAttrName(name)] = namespaceReferences(name, rawValue, options.instanceId);
  }

  const state = authoredId ? options.elementStates?.[authoredId] : undefined;
  if (state) {
    const animatedTransform = svgElementStateToTransform(state);
    if (animatedTransform) {
      // Compose with any authored transform. An SVG transform list applies left to right, each
      // entry acting inside the space the previous one established, so putting the animated
      // transform second makes it operate in the element's own placed space.
      const authored = typeof props.transform === "string" ? props.transform : "";
      props.transform = authored ? `${authored} ${animatedTransform}` : animatedTransform;
    }
    if (state.opacity !== 1) {
      props.opacity = state.opacity;
    }
  }

  return props;
}

/** Elements whose stroke can be dashed to produce a draw-on reveal. */
const STROKEABLE_TAGS = new Set(["path", "line", "polyline", "polygon", "circle", "ellipse", "rect"]);

/**
 * Applies a draw-on reveal to one strokeable element.
 * pathLength restates the geometry's length as a fixed number, so one dash of that length plus a
 * dash offset of the undrawn fraction reveals the stroke evenly whatever its real length is.
 */
function applyDrawOn(props: Record<string, unknown>, drawOn: number, pathLength: number): void {
  props.pathLength = pathLength;
  props.strokeDasharray = pathLength;
  props.strokeDashoffset = Math.round((1 - drawOn) * pathLength * 1e4) / 1e4;
}

/**
 * Recursively converts one parsed SVG node into its React element.
 * A draw-on reveal declared on a container is carried down to the strokeable elements inside it,
 * because stroke dashing only means anything on the geometry that actually carries the stroke.
 */
export function renderSvgNode(
  node: SvgNode,
  key: string,
  options: SvgNodeRenderOptions,
  inheritedDrawOn?: number,
): React.ReactElement {
  const props = buildProps(node, key, options);
  const authoredId = node.attrs.id;
  const ownDrawOn = authoredId ? options.elementStates?.[authoredId]?.drawOn : undefined;
  const drawOn = ownDrawOn !== undefined && ownDrawOn !== 1 ? ownDrawOn : inheritedDrawOn;

  const pathLength = options.defaultPathLength ?? 1000;
  const isStrokeable = STROKEABLE_TAGS.has(node.tag);
  if (drawOn !== undefined && drawOn !== 1 && isStrokeable) {
    applyDrawOn(props, drawOn, pathLength);
  }

  const children: React.ReactNode[] = [];
  if (node.text) children.push(node.text);
  node.children.forEach((child, idx) => {
    children.push(renderSvgNode(child, `${key}.${idx}`, options, isStrokeable ? undefined : drawOn));
  });
  return React.createElement(
    node.tag,
    props,
    children.length > 0 ? children : undefined,
  );
}

/** Converts a list of parsed SVG nodes into React elements with stable keys. */
export function renderSvgNodes(
  nodes: SvgNode[],
  options: SvgNodeRenderOptions,
): React.ReactElement[] {
  return nodes.map((node, idx) => renderSvgNode(node, `n${idx}`, options));
}
