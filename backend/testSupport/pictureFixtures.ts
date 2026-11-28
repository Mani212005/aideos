/**
 * File Description: Tiny synthetic pictures for the illustrated stage's tests and its fixture packages, drawn pixel by pixel in code (never generated art, never an image service): a dark plate with a faint accent grid, an accent orb on a transparent background, a neutral chip, a lens (steel ring, dark glass, glowing core) for the worked example of SVG callouts on a picture, and the cases the picture rules must catch (strong colour off the accent, a busy plate, and the committed word picture for the no-text rule). `writePicturesStageFixture` and `writePictureCalloutsFixture` store each fixture film's pictures in a package through the real picture cache, with a fixed date so the files are byte for byte reproducible; run this file to rewrite test_fixtures/packages/pictures-stage/ and test_fixtures/packages/picture-callouts/ visuals/generated/.
 * Inputs and outputs: nothing, or a package directory -> RGBA images, PNG bytes and the stored records of the fixture pictures.
 * Used by: backend/pictures/*.test.ts, backend/designCheck/pictures.test.ts, backend/journeys/pictures_stage.journey.ts, and by hand to refresh the fixture packages.
 */

import path from "node:path";
import { encodePng, type RgbaImage } from "../pictures/png";
import { storePicture, type PictureRecord, type PictureRequest } from "../pictures/cache";

/** Paints an image from a function of its pixel centre, returning [r, g, b, a] 0 to 255. */
export function paint(width: number, height: number, at: (x: number, y: number) => [number, number, number, number]): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = at(x + 0.5, y + 0.5);
      rgba.set([r, g, b, a].map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** A soft-edged disc mask: 1 inside radius `r`, fading to 0 over `soft` pixels. */
function disc(x: number, y: number, cx: number, cy: number, r: number, soft = 1.5): number {
  const d = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, (r - d) / soft + 0.5));
}

/** The plate: 48 x 48, the dark canvas lit softly in the middle with a faint accent-hued grid every 8 pixels. */
export function platePicture(): RgbaImage {
  return paint(48, 48, (x, y) => {
    const glow = Math.max(0, 1 - Math.hypot(x - 24, y - 30) / 30);
    const base = [12 + 10 * glow, 12 + 9 * glow, 16 + 22 * glow];
    const grid = (Math.floor(x) % 8 === 0 || Math.floor(y) % 8 === 0) ? 0.55 : 0;
    return [base[0] + 14 * grid, base[1] + 12 * grid, base[2] + 44 * grid, 255];
  });
}

/** The orb: 32 x 32, an accent violet sphere (lighter towards its upper left) on a transparent background. */
export function orbPicture(): RgbaImage {
  return paint(32, 32, (x, y) => {
    const a = disc(x, y, 16, 16, 13);
    const light = Math.max(0, 1 - Math.hypot(x - 12, y - 11) / 16);
    return [70 + 70 * light, 64 + 66 * light, 220 + 35 * light, 255 * a];
  });
}

/** The chip: 24 x 24, a neutral grey die with a lighter rim and a dark core, on a transparent 2 pixel margin. */
export function chipPicture(): RgbaImage {
  return paint(24, 24, (x, y) => {
    const inside = x > 2 && x < 22 && y > 2 && y < 22;
    if (!inside) return [0, 0, 0, 0];
    const rim = x < 4 || x > 20 || y < 4 || y > 20;
    const core = x > 8 && x < 16 && y > 8 && y < 16;
    const v = rim ? 138 : core ? 38 : 64;
    return [v, v, v + 4, 255];
  });
}

/**
 * The lens: 96 x 96 on a transparent background, the hero of the picture-callouts example: a dark steel ring
 * (radius 39 to 47), dark violet-tinted glass inside it, and a glowing accent core (radius 10), lit from the upper left.
 */
export function lensPicture(): RgbaImage {
  return paint(96, 96, (x, y) => {
    const d = Math.hypot(x - 48, y - 48);
    const a = Math.max(0, Math.min(1, (47 - d) / 1.5 + 0.5));
    if (a <= 0) return [0, 0, 0, 0];
    const light = Math.max(0, 1 - Math.hypot(x - 34, y - 32) / 70);
    // Each boundary is blended over about a pixel so the enlarged picture keeps smooth edges.
    const ring = Math.max(0, Math.min(1, (d - 39) / 1.5 + 0.5));
    const core = Math.max(0, Math.min(1, (10 - d) / 3 + 0.5));
    const glow = Math.max(0, 1 - d / 30);
    const v = 70 + 40 * light;
    const steel = [v, v, v + 6];
    const glass = [22 + 14 * light + 18 * glow, 20 + 12 * light + 16 * glow, 40 + 22 * light + 50 * glow];
    const accent = [120, 110, 255];
    const inner = [0, 1, 2].map((k) => glass[k] * (1 - core) + accent[k] * core);
    return [0, 1, 2].map((k) => steel[k] * ring + inner[k] * (1 - ring)).concat(255 * a) as [number, number, number, number];
  });
}

/** A case the palette rule must catch: a saturated orange disc, far from a violet accent. */
export function offPalettePicture(): RgbaImage {
  return paint(32, 32, (x, y) => [255, 120, 20, 255 * disc(x, y, 16, 16, 14)]);
}

/** A case the contrast rule must catch: a hard black and white checkerboard plate (4 pixel squares). */
export function busyPlatePicture(): RgbaImage {
  return paint(48, 48, (x, y) => {
    const v = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 245 : 8;
    return [v, v, v, 255];
  });
}

/** A case the no-text rule must catch: the word SIGNAL in Geist Bold drawn by the native renderer (test_fixtures/pictures/README.md). */
export const TEXT_PICTURE_FIXTURE = path.resolve(__dirname, "../../test_fixtures/pictures/text-signal.png");

/** The fixture film's style paragraph, tool label and pictures, as its design.json declares them. */
export const PICTURES_STAGE = {
  style: "Quiet dark stage, soft violet glow from below, smooth matte surfaces, gentle studio light, no glare.",
  tool: "synthetic-fixture",
  items: [
    { id: "plate", prompt: "A wide empty dark floor that fades into shadow, lit from the middle.", aspect: "1:1", cutout: "none", draw: platePicture },
    { id: "orb", prompt: "One smooth glass sphere glowing softly in violet.", aspect: "1:1", cutout: "generator-alpha", draw: orbPicture },
    { id: "chip", prompt: "One square matte processor die with a lighter rim.", aspect: "1:1", cutout: "generator-alpha", draw: chipPicture },
  ],
} as const;

/** The picture-callouts example film's style paragraph, tool label and pictures, as its design.json declares them. */
export const PICTURE_CALLOUTS = {
  style: PICTURES_STAGE.style,
  tool: PICTURES_STAGE.tool,
  items: [
    { id: "plate", prompt: "A wide empty dark floor that fades into shadow, lit from the middle.", aspect: "1:1", cutout: "none", draw: platePicture },
    { id: "lens", prompt: "One round optical lens in a dark steel ring with a softly glowing violet core.", aspect: "1:1", cutout: "generator-alpha", draw: lensPicture },
  ],
} as const;

/** The fixed date the fixture pictures are recorded with, so their records are reproducible. */
export const FIXTURE_DATE = new Date("2026-11-20T00:00:00.000Z");

/** Stores the fixture film's three pictures in a package through the picture cache and returns each record by picture id. */
export function writePicturesStageFixture(pkgDir: string): Record<string, PictureRecord> {
  const out: Record<string, PictureRecord> = {};
  for (const item of PICTURES_STAGE.items) {
    const request: PictureRequest = { style: PICTURES_STAGE.style, prompt: item.prompt, aspect: item.aspect, tool: PICTURES_STAGE.tool, cutout: item.cutout };
    out[item.id] = storePicture(pkgDir, request, encodePng(item.draw()), { seconds: 0, createdAt: FIXTURE_DATE });
  }
  return out;
}

/** Stores the picture-callouts example film's pictures in a package through the picture cache and returns each record by picture id. */
export function writePictureCalloutsFixture(pkgDir: string): Record<string, PictureRecord> {
  const out: Record<string, PictureRecord> = {};
  for (const item of PICTURE_CALLOUTS.items) {
    const request: PictureRequest = { style: PICTURE_CALLOUTS.style, prompt: item.prompt, aspect: item.aspect, tool: PICTURE_CALLOUTS.tool, cutout: item.cutout };
    out[item.id] = storePicture(pkgDir, request, encodePng(item.draw()), { seconds: 0, createdAt: FIXTURE_DATE });
  }
  return out;
}

// Rewrites the committed fixture pictures when run directly, printing each pin for design.json.
if (typeof require !== "undefined" && require.main === module) {
  const fixtures = path.resolve(__dirname, "../../test_fixtures/packages");
  for (const [slug, write] of [["pictures-stage", writePicturesStageFixture], ["picture-callouts", writePictureCalloutsFixture]] as const) {
    for (const [id, record] of Object.entries(write(path.join(fixtures, slug)))) console.log(`${slug} ${id}: visuals/generated/${record.fingerprint}.png sha256 ${record.sha256} (${record.width} x ${record.height})`);
  }
}
