/**
 * File Description: Expands a character's authored parts (mirror groups and skeleton-driven generators) into flat geometry primitives.
 * Inputs and outputs: CharacterSpec -> ordered resolved parts (tube, head, panel, facets) plus issues naming the authored field.
 * Used by: character validation and the Three character builder; pure data, no renderer.
 */
import { partSchema, type CharacterPart, type CharacterSpec, type MirrorGroup } from "./schema";
import { characterJoints, mirrorVec, mirrorX, SIDE_SIGN, type Side } from "./rig";
import type { Vec3 } from "../performance/types";

export type Radius = number | readonly [number, number];
export interface SurfaceProfile { y: readonly number[]; rx: readonly number[]; rz: readonly number[] }
export type Primitive =
  | { kind: "tube" | "head"; points: Vec3[]; radii: Radius[]; origin: Vec3; segments: number; radial: number; caps: readonly [number, number] }
  | { kind: "panel"; surface: SurfaceProfile; a: Array<readonly [number, number]>; b: Array<readonly [number, number]>; lift: number; steps: number }
  | { kind: "facets"; triangles: Vec3[] };
/** One mesh the builder creates, in creation order. */
export interface ResolvedPart {
  id: string;
  joint: string;
  /** Palette token; null for the head, whose surface is the painted face. */
  material: string | null;
  shading: "toon" | "flat";
  ink: number;
  doubleSided: boolean;
  side: Side | null;
  geometry: Primitive;
  /** Authored field path, so a later failure names where to fix it. */
  path: string;
}
export interface CharacterIssue { path: string; message: string }

// Distinguishes a mirror group from a single part.
const isMirrorGroup = (entry: CharacterPart | MirrorGroup): entry is MirrorGroup => "mirror" in entry;

// Substitutes the side into an id or joint template, or reports a template used outside a mirror group.
function sided(template: string, side: Side | null, path: string, issues: CharacterIssue[]): string {
  if (!template.includes("{side}")) return template;
  if (!side) issues.push({ path, message: `"${template}" uses {side} outside a mirror group` });
  return template.replace("{side}", side ?? "");
}

// Expands every authored part, in order, into the primitives the builder draws.
export function expandParts(spec: CharacterSpec): { parts: ResolvedPart[]; issues: CharacterIssue[] } {
  const issues: CharacterIssue[] = [];
  const parts: ResolvedPart[] = [];
  const offsets = new Map(characterJoints(spec).map((j) => [j.id, j]));
  const defaultInk = spec.outline.width;

  // Resolves one authored part for one side (null outside mirror groups).
  const resolve = (part: CharacterPart, side: Side | null, path: string): void => {
    const m = (v: readonly number[]): Vec3 => (side ? mirrorVec(v, side) : [v[0], v[1], v[2]]);
    const joint = sided(part.joint, side, `${path}.joint`, issues);
    if (part.type === "hand") {
      const handSide: Side | null = side ?? (joint.endsWith("L") ? "L" : joint.endsWith("R") ? "R" : null);
      if (!handSide || !joint.startsWith("wrist")) { issues.push({ path: `${path}.joint`, message: `a hand rides on wristL or wristR, not "${joint}"` }); return; }
      const sign = SIDE_SIGN[handSide];
      const fingersJoint = `fingers${handSide}`, thumbJoint = `thumb${handSide}`;
      const fingersAt = offsets.get(fingersJoint)?.offset ?? [0, -0.3, 0];
      const name = (template: string, i?: number) => template.replace("{side}", handSide).replace("{i}", String(i ?? ""));
      const base = { material: part.material, shading: part.shading, doubleSided: part.doubleSided, side: handSide };
      parts.push({ ...base, id: name(part.palm.name), joint, ink: part.palm.ink, path: `${path}.palm`, geometry: { kind: "tube", points: [[0, 0, 0], [fingersAt[0], fingersAt[1], fingersAt[2]]], radii: [...part.palm.radii], origin: [0, 0, 0], segments: 20, radial: 20, caps: [1, 1] } });
      const f = part.fingers;
      if (f.lengths.length !== f.count || f.curls.length !== f.count) issues.push({ path: `${path}.fingers`, message: `lengths and curls need ${f.count} entries, one per finger` });
      for (let i = 0; i < f.count; i++) {
        const x = (i - (f.count - 1) / 2) * f.spacing, L = f.lengths[i] ?? 1, c = f.curls[i] ?? 0;
        parts.push({ ...base, id: name(f.name, i), joint: fingersJoint, ink: f.ink, path: `${path}.fingers`, geometry: {
          kind: "tube", origin: [0, 0, 0], segments: f.segments, radial: f.radial, caps: [1, 1], radii: [...f.radii],
          points: [[x, 0, 0], [x * f.fan[0] + f.shift[0] * sign, -f.reach[0] * L, f.depth[0]], [x * f.fan[1] + f.shift[1] * sign * c, -f.reach[1] * L, f.depth[1] + f.depth[2] * c]],
        } });
      }
      parts.push({ ...base, id: name(part.thumb.name), joint: thumbJoint, ink: part.thumb.ink, path: `${path}.thumb`, geometry: { kind: "tube", points: part.thumb.points.map((p) => mirrorVec(p, handSide)), radii: [...part.thumb.radii], origin: [0, 0, 0], segments: part.thumb.segments, radial: part.thumb.radial, caps: [1, 1] } });
      return;
    }
    const id = sided(part.id, side, `${path}.id`, issues);
    const common = { id, joint, side, path, ink: part.ink ?? defaultInk };
    switch (part.type) {
      case "head":
        parts.push({ ...common, material: null, shading: "flat", doubleSided: false, geometry: { kind: "head", points: part.points.map(m), radii: [...part.radii], origin: m(part.origin), segments: part.segments, radial: part.radial, caps: part.caps } });
        return;
      case "tube":
        parts.push({ ...common, material: part.material, shading: part.shading, doubleSided: part.doubleSided, geometry: { kind: "tube", points: part.points.map(m), radii: [...part.radii], origin: m(part.origin), segments: part.segments, radial: part.radial, caps: part.caps } });
        return;
      case "panel": {
        const surface = spec.surfaces[part.surface];
        if (!surface) { issues.push({ path: `${path}.surface`, message: `unknown surface "${part.surface}" (surfaces: ${Object.keys(spec.surfaces).join(", ") || "none"})` }); return; }
        if (part.a.length !== part.b.length) issues.push({ path: `${path}.b`, message: `needs ${part.a.length} points to match a` });
        const flat = (v: readonly number[]) => [side ? mirrorX(v[0], side) : v[0], v[1]] as const;
        parts.push({ ...common, material: part.material, shading: part.shading, doubleSided: part.doubleSided, geometry: { kind: "panel", surface, a: part.a.map(flat), b: part.b.map(flat), lift: part.lift, steps: part.steps } });
        return;
      }
      case "facets": {
        if (part.triangles.length % 3) issues.push({ path: `${path}.triangles`, message: "needs a multiple of three corners" });
        const triangles = part.triangles.map(m);
        // Mirroring reverses winding; swap two corners so normals still face outward.
        if (side === "R") for (let i = 0; i + 2 < triangles.length; i += 3) [triangles[i + 1], triangles[i + 2]] = [triangles[i + 2], triangles[i + 1]];
        parts.push({ ...common, material: part.material, shading: part.shading, doubleSided: part.doubleSided, geometry: { kind: "facets", triangles } });
        return;
      }
      case "limb": {
        const to = sided(part.to, side, `${path}.to`, issues);
        const end = offsets.get(to);
        if (!end || end.parent !== joint) { issues.push({ path: `${path}.to`, message: `"${to}" must be a child joint of "${joint}"` }); return; }
        const bend = m(part.bend), e = end.offset;
        parts.push({ ...common, material: part.material, shading: part.shading, doubleSided: part.doubleSided, geometry: {
          kind: "tube", points: [m(part.start), [e[0] * 0.5 + bend[0], e[1] * 0.5 + bend[1], e[2] * 0.5 + bend[2]], [e[0], e[1], e[2]]],
          radii: [...part.radii], origin: [0, 0, 0], segments: part.segments, radial: part.radial, caps: part.caps,
        } });
        return;
      }
      case "torso": {
        const surface = spec.surfaces[part.surface];
        if (!surface) { issues.push({ path: `${path}.surface`, message: `unknown surface "${part.surface}" (surfaces: ${Object.keys(spec.surfaces).join(", ") || "none"})` }); return; }
        const center = m(part.center);
        parts.push({ ...common, material: part.material, shading: part.shading, doubleSided: part.doubleSided, geometry: {
          kind: "tube", points: surface.y.map((y) => [center[0], center[1] + y, center[2]] as Vec3), radii: surface.rx.map((rx, i) => [rx, surface.rz[i] ?? rx] as const),
          origin: center, segments: part.segments, radial: part.radial, caps: part.caps,
        } });
        return;
      }
    }
  };

  spec.parts.forEach((entry, i) => {
    if (!isMirrorGroup(entry)) { resolve(entry, null, `parts[${i}]`); return; }
    for (const side of entry.mirror as readonly Side[]) {
      entry.parts.forEach((part, j) => {
        const key = "id" in part ? part.id : part.joint;
        const override = entry.overrides[side]?.[key];
        if (!override) { resolve(part, side, `parts[${i}].parts[${j}]`); return; }
        const merged = partSchema.safeParse({ ...part, ...override });
        if (!merged.success) {
          for (const issue of merged.error.issues) issues.push({ path: `parts[${i}].overrides.${side}.${key}${issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("")}`, message: issue.message });
          return;
        }
        resolve(merged.data, side, `parts[${i}].overrides.${side}.${key}`);
      });
    }
  });
  return { parts, issues };
}
