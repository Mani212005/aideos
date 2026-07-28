import * as THREE from "three";

/**
 * A procedural leaf surface.
 *
 * The previous version drew a two-path SVG blob and called it `Scene3D`. This
 * builds an actual curved surface so the light rig has something to catch:
 * the blade cups upward at the margins, arches away toward the tip, twists
 * slightly along its length, and carries fine serration on the edge.
 */

export type LeafParams = {
  segmentsU?: number;
  segmentsV?: number;
  length?: number;
  width?: number;
  /** How much the margins curl toward the viewer. */
  cup?: number;
  /** How far the tip bends away from the camera. */
  arch?: number;
  /** Longitudinal twist, radians end to end. */
  twist?: number;
  /** Depth of the marginal teeth, as a fraction of local half-width. */
  serration?: number;
  /** Height of the raised midrib. */
  ribHeight?: number;
};

// Peak of u^0.5 * (1-u)^0.75 occurs at u = 0.4; used to normalise the silhouette
// so `width` means what it says regardless of the exponents.
const WIDTH_NORM = Math.pow(0.4, 0.5) * Math.pow(0.6, 0.75);

/** Half-width of the blade at normalised length `u` (0 = petiole, 1 = apex). */
const halfWidthAt = (u: number, width: number, serration: number) => {
  const ovate = (Math.pow(u, 0.5) * Math.pow(1 - u, 0.75)) / WIDTH_NORM;
  // Teeth fade out at both ends so the apex stays a clean point.
  const teeth = 1 + serration * Math.sin(u * Math.PI * 22) * Math.sin(Math.PI * u);
  return (width / 2) * ovate * teeth;
};

export const createLeafGeometry = ({
  segmentsU = 140,
  segmentsV = 56,
  length = 6.4,
  width = 3.1,
  cup = 0.62,
  arch = 1.15,
  twist = 0.22,
  serration = 0.03,
  ribHeight = 0.075,
}: LeafParams = {}): THREE.BufferGeometry => {
  const positions = new Float32Array((segmentsU + 1) * (segmentsV + 1) * 3);
  const uvs = new Float32Array((segmentsU + 1) * (segmentsV + 1) * 2);
  const indices: number[] = [];

  let p = 0;
  let q = 0;

  for (let iu = 0; iu <= segmentsU; iu++) {
    const u = iu / segmentsU;
    const hw = halfWidthAt(u, width, serration);
    const y = (u - 0.5) * length;

    // Cross-section twist, strongest at the tip.
    const tw = twist * (u - 0.5) * 2;
    const cosT = Math.cos(tw);
    const sinT = Math.sin(tw);

    // The blade arches away from camera as it approaches the apex.
    const zArch = -arch * Math.pow(u, 2.1) + arch * 0.12;

    for (let iv = 0; iv <= segmentsV; iv++) {
      // t runs -1 (left margin) .. +1 (right margin)
      const t = (iv / segmentsV) * 2 - 1;

      const x = t * hw;
      // Margins curl toward the viewer, scaled by how wide the blade is here.
      const zCup = cup * t * t * (hw / (width / 2));
      // A raised ridge along the midrib.
      const zRib = ribHeight * Math.exp(-(t * t) / 0.012);

      const zLocal = zCup + zRib + zArch;

      positions[p++] = x * cosT - zLocal * sinT;
      positions[p++] = y;
      positions[p++] = x * sinT + zLocal * cosT;

      // u across the width, v along the length — matches the vein texture.
      uvs[q++] = (t + 1) / 2;
      uvs[q++] = u;
    }
  }

  const rowLength = segmentsV + 1;
  for (let iu = 0; iu < segmentsU; iu++) {
    for (let iv = 0; iv < segmentsV; iv++) {
      const a = iu * rowLength + iv;
      const b = a + 1;
      const c = a + rowLength;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

/** The petiole, as a tapered tube curving down from the leaf base. */
export const createStemGeometry = (length = 6.4): THREE.BufferGeometry => {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -length / 2 + 0.05, 0.12),
    new THREE.Vector3(0.06, -length / 2 - 0.5, 0.2),
    new THREE.Vector3(0.02, -length / 2 - 1.1, 0.1),
    new THREE.Vector3(-0.16, -length / 2 - 1.6, -0.08),
  ]);
  return new THREE.TubeGeometry(curve, 40, 0.055, 12, false);
};

type VeinStyle = {
  base: string;
  midrib: string;
  secondary: string;
  tertiary: string;
  mottle: string;
  midribWidth: number;
  secondaryWidth: number;
  blur: number;
};

const drawVeins = (size: number, style: VeinStyle): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D context for the leaf vein texture.");

  ctx.fillStyle = style.base;
  ctx.fillRect(0, 0, size, size);

  // Soft mottling so the blade is not a flat wash. Deterministic offsets only —
  // Math.random() here would make the texture differ between render workers.
  const blotches = 26;
  for (let i = 0; i < blotches; i++) {
    const a = (i * 2.399963) % (Math.PI * 2);
    const r = 0.16 + ((i * 0.137) % 0.34);
    const cx = size * (0.5 + Math.cos(a) * r * 0.8);
    const cy = size * (0.5 + Math.sin(a * 1.7) * r);
    const rad = size * (0.05 + ((i * 0.041) % 0.09));
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, style.mottle);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  if (style.blur > 0) ctx.filter = `blur(${style.blur}px)`;

  const mid = size / 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Midrib, tapering from base to apex.
  ctx.strokeStyle = style.midrib;
  for (let i = 0; i < 24; i++) {
    const y0 = (i / 24) * size;
    const y1 = ((i + 1) / 24) * size;
    ctx.lineWidth = style.midribWidth * (1 - (i / 24) * 0.75);
    ctx.beginPath();
    ctx.moveTo(mid, y0);
    ctx.lineTo(mid, y1);
    ctx.stroke();
  }

  // Secondary veins, branching alternately and sweeping toward the apex.
  const pairs = 11;
  for (let i = 0; i < pairs; i++) {
    const u = 0.07 + (i / pairs) * 0.82;
    const y = u * size;
    // Reach follows the blade silhouette so veins stop at the margin.
    const reach = halfWidthAt(u, 1, 0) * size * 0.95;
    const rise = size * 0.075;

    for (const dir of [-1, 1]) {
      ctx.lineWidth = style.secondaryWidth * (1 - u * 0.45);
      ctx.strokeStyle = style.secondary;
      ctx.beginPath();
      ctx.moveTo(mid, y);
      ctx.quadraticCurveTo(mid + dir * reach * 0.55, y - rise * 0.45, mid + dir * reach, y - rise);
      ctx.stroke();

      // Tertiary cross-links between neighbouring secondaries.
      ctx.lineWidth = Math.max(1, style.secondaryWidth * 0.35);
      ctx.strokeStyle = style.tertiary;
      for (let k = 1; k <= 3; k++) {
        const f = k / 4;
        ctx.beginPath();
        ctx.moveTo(mid + dir * reach * f, y - rise * f * 0.8);
        ctx.quadraticCurveTo(
          mid + dir * reach * (f + 0.12),
          y - rise * f - size * 0.018,
          mid + dir * reach * (f + 0.05),
          y - size * 0.042,
        );
        ctx.stroke();
      }
    }
  }

  ctx.filter = "none";
  return canvas;
};

export type LeafTextures = {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  /** A dark vertical gradient used as an equirect env map for waxy reflections. */
  envMap: THREE.CanvasTexture;
};

export const createLeafTextures = (): LeafTextures => {
  // Kept close to white: `material.color` and the pigment shader supply the hue,
  // so baking colour in here would fight the green-to-purple wash.
  const colorCanvas = drawVeins(1024, {
    base: "#cfcfcf",
    midrib: "rgba(255,255,255,0.92)",
    secondary: "rgba(255,255,255,0.55)",
    tertiary: "rgba(255,255,255,0.22)",
    mottle: "rgba(255,255,255,0.10)",
    midribWidth: 15,
    secondaryWidth: 7,
    blur: 0.6,
  });

  const bumpCanvas = drawVeins(1024, {
    base: "#7a7a7a",
    midrib: "#ffffff",
    secondary: "#d8d8d8",
    tertiary: "#a4a4a4",
    mottle: "rgba(255,255,255,0.16)",
    midribWidth: 20,
    secondaryWidth: 10,
    blur: 2.2,
  });

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = 8;

  // A tiny studio environment, generated rather than fetched — a network HDR
  // would stall or fail inside the render workers.
  const envCanvas = document.createElement("canvas");
  envCanvas.width = 512;
  envCanvas.height = 256;
  const ectx = envCanvas.getContext("2d");
  if (!ectx) throw new Error("Could not get a 2D context for the environment map.");
  const grad = ectx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#4d5f6b"); // sky-ish top, gives the waxy top highlight
  grad.addColorStop(0.45, "#1b2429");
  grad.addColorStop(1, "#07090b"); // dark floor
  ectx.fillStyle = grad;
  ectx.fillRect(0, 0, 512, 256);
  // A soft overhead softbox so the clearcoat has something to reflect.
  const box = ectx.createRadialGradient(150, 40, 0, 150, 40, 190);
  box.addColorStop(0, "rgba(255,255,255,0.85)");
  box.addColorStop(1, "rgba(255,255,255,0)");
  ectx.fillStyle = box;
  ectx.fillRect(0, 0, 512, 256);

  const envMap = new THREE.CanvasTexture(envCanvas);
  envMap.mapping = THREE.EquirectangularReflectionMapping;
  envMap.colorSpace = THREE.SRGBColorSpace;

  return { map, bumpMap, envMap };
};
