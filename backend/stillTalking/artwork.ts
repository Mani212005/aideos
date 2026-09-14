/**
 * File Description: Vector artwork for the film "Still Talking".
 * Builds every SVG asset of the film as static source text with stable, named element ids, which
 * are the handles the animation timelines drive. Geometry that a person cannot type accurately by
 * hand (a groove spiral, a star field, a sixty cell survey grid, a set of orbit rings) is computed
 * here so the drawing and the timeline agree on the same ids and the same coordinates. Nothing
 * emitted here animates itself: the assets are static documents, exactly as the scene engine
 * requires, and all motion lives in the separate declarative timelines.
 */

/** Colour tokens of the rendered-video design language, written literally into SVG attributes. */
export const COLOR = {
  canvas: "#0A0A0B",
  surface: "#141416",
  ink: "#F5F5F5",
  muted: "#8A8A8E",
  accent: "#635BFF",
} as const;

/** Hairline at a chosen strength, the design language's only depth cue. */
function hairline(strength = 1): string {
  return `rgba(245, 245, 245, ${(0.1 * strength).toFixed(3)})`;
}

/** Ink at an arbitrary alpha, for the faint ends of the greyscale ramp. */
function inkAlpha(alpha: number): string {
  return `rgba(245, 245, 245, ${alpha.toFixed(3)})`;
}

/** Accent at an arbitrary alpha, used only where the accent is deliberately receding. */
function accentAlpha(alpha: number): string {
  return `rgba(99, 91, 255, ${alpha.toFixed(3)})`;
}

/** Deterministic 32 bit PRNG, so a regenerated star field is byte identical to the committed one. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rounds a coordinate to two decimals so emitted path data stays stable and readable. */
function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Wraps a body of elements in the project's standard asset document frame. */
function document_(description: string, body: string): string {
  return [
    "<!--",
    `  File Description: ${description}`,
    "  Static artwork for the film Still Talking. Nothing here animates itself: element ids are the",
    "  handles that videos/still-talking/film.json drives through the declarative SVG timeline.",
    "-->",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">',
    body.trimEnd(),
    "</svg>",
    "",
  ].join("\n");
}

/** Builds the backdrop: the film's own dark ground plus one very faint band of distant light. */
function buildSpace(): string {
  return document_(
    "The void the whole film sits on, with one faint galactic band for depth.",
    [
      "  <defs>",
      '    <radialGradient id="band-grad" cx="50%" cy="50%" r="50%">',
      `      <stop offset="0%" stop-color="${COLOR.ink}" stop-opacity="0.05" />`,
      `      <stop offset="52%" stop-color="${COLOR.ink}" stop-opacity="0.018" />`,
      `      <stop offset="100%" stop-color="${COLOR.ink}" stop-opacity="0" />`,
      "    </radialGradient>",
      "  </defs>",
      '  <rect id="void-fill" x="-320" y="-220" width="640" height="440" fill="' + COLOR.canvas + '" />',
      '  <g id="milky-band">',
      // No hard edge anywhere: a band with a visible boundary reads as a shape, not as depth.
      '    <ellipse id="milky-band-1" cx="-40" cy="-30" rx="330" ry="96" transform="rotate(-9 -40 -30)" fill="url(#band-grad)" />',
      '    <ellipse id="milky-band-2" cx="70" cy="6" rx="270" ry="54" transform="rotate(-7 70 6)" fill="url(#band-grad)" />',
      "  </g>",
    ].join("\n"),
  );
}

/** One star field layer: scattered points plus a handful of named stars bright enough to twinkle. */
function buildStarField(options: {
  id: string;
  description: string;
  seed: number;
  count: number;
  xMin: number;
  xMax: number;
  yExtent: number;
  radiusMin: number;
  radiusMax: number;
  opacityMin: number;
  opacityMax: number;
  twinkles: number;
}): string {
  const rand = mulberry32(options.seed);
  const stars: string[] = [];
  for (let i = 0; i < options.count; i++) {
    const x = r2(options.xMin + rand() * (options.xMax - options.xMin));
    const y = r2(-options.yExtent + rand() * options.yExtent * 2);
    const radius = r2(options.radiusMin + rand() * (options.radiusMax - options.radiusMin));
    const opacity = r2(options.opacityMin + rand() * (options.opacityMax - options.opacityMin));
    stars.push(
      `      <circle cx="${x}" cy="${y}" r="${radius}" fill="${COLOR.ink}" opacity="${opacity}" />`,
    );
  }

  // A few stars are named so the timeline can breathe life into the field without moving it.
  const twinkles: string[] = [];
  for (let i = 0; i < options.twinkles; i++) {
    const x = r2(options.xMin + rand() * (options.xMax - options.xMin));
    const y = r2(-options.yExtent + rand() * options.yExtent * 2);
    const radius = r2(options.radiusMax * (0.9 + rand() * 0.5));
    twinkles.push(
      `    <circle id="${options.id}-twinkle-${i + 1}" cx="${x}" cy="${y}" r="${radius}" ` +
        `fill="${COLOR.ink}" opacity="0.7" />`,
    );
  }

  return document_(
    options.description,
    [
      `  <g id="${options.id}">`,
      `    <g id="${options.id}-field">`,
      stars.join("\n"),
      "    </g>",
      twinkles.join("\n"),
      "  </g>",
    ].join("\n"),
  );
}

/** Builds the sun: a core, a graded halo and a spike pattern that fades as the film travels out. */
function buildSun(): string {
  const rays: string[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    // Four long spikes on the cardinals, four short ones between: the shape a bright point makes
    // through a lens, rather than the shape a child draws.
    const outer = i % 2 === 0 ? 84 : 52;
    const alpha = i % 2 === 0 ? 0.26 : 0.14;
    rays.push(
      `      <line x1="${r2(Math.cos(angle) * 26)}" y1="${r2(Math.sin(angle) * 26)}" ` +
        `x2="${r2(Math.cos(angle) * outer)}" y2="${r2(Math.sin(angle) * outer)}" ` +
        `stroke="${inkAlpha(alpha)}" stroke-width="1.2" />`,
    );
  }

  return document_(
    "The sun: home, and the fixed point the signal is always aimed back at.",
    [
      "  <defs>",
      '    <radialGradient id="sun-halo-grad" cx="50%" cy="50%" r="50%">',
      `      <stop offset="0%" stop-color="${COLOR.ink}" stop-opacity="0.4" />`,
      `      <stop offset="38%" stop-color="${COLOR.ink}" stop-opacity="0.1" />`,
      `      <stop offset="100%" stop-color="${COLOR.ink}" stop-opacity="0" />`,
      "    </radialGradient>",
      "  </defs>",
      '  <g id="sun-body">',
      '    <circle id="sun-halo" cx="0" cy="0" r="96" fill="url(#sun-halo-grad)" />',
      '    <g id="sun-rays">',
      rays.join("\n"),
      "    </g>",
      `    <circle id="sun-corona" cx="0" cy="0" r="30" fill="none" stroke="${hairline(2.2)}" stroke-width="1.1" />`,
      `    <circle id="sun-core" cx="0" cy="0" r="19" fill="${COLOR.ink}" />`,
      "  </g>",
    ].join("\n"),
  );
}

/** Builds the solar system we leave behind: concentric orbit rings with Earth marked on the first. */
function buildHomeSystem(): string {
  const orbits = [
    { id: "orbit-earth", radius: 152, alpha: 0.28 },
    { id: "orbit-mars", radius: 208, alpha: 0.22 },
    { id: "orbit-jupiter", radius: 316, alpha: 0.19 },
    { id: "orbit-saturn", radius: 406, alpha: 0.16 },
    { id: "orbit-uranus", radius: 506, alpha: 0.13 },
    { id: "orbit-neptune", radius: 592, alpha: 0.11 },
  ];
  const rings = orbits.map(
    (orbit) =>
      `    <circle id="${orbit.id}" cx="0" cy="0" r="${orbit.radius}" fill="none" ` +
      `stroke="${inkAlpha(orbit.alpha)}" stroke-width="1.3" />`,
  );

  // Earth sits on its own ring, up and to the right, so it reads as a place rather than a diagram.
  const earthAngle = (-38 * Math.PI) / 180;
  const ex = r2(Math.cos(earthAngle) * 152);
  const ey = r2(Math.sin(earthAngle) * 152);

  return document_(
    "The system the craft is leaving: six orbit rings and the one dot that is home.",
    [
      '  <g id="home-rings">',
      rings.join("\n"),
      "  </g>",
      `  <g id="earth-marker" transform="translate(${ex}, ${ey})">`,
      `    <circle id="earth-halo" cx="0" cy="0" r="15" fill="none" stroke="${accentAlpha(0.45)}" stroke-width="1.2" />`,
      `    <circle id="earth-dot" cx="0" cy="0" r="6.5" fill="${COLOR.accent}" />`,
      "  </g>",
    ].join("\n"),
  );
}

/**
 * Builds the craft itself: dish, bus, booms, instrument lamps, the record on its flank, and the
 * signal thread that runs from the dish back toward the sun. The thread lives inside the craft so
 * it stays welded to the feed horn no matter how the craft moves.
 */
function buildProbe(): string {
  // Instrument lamps, spaced along the science boom, are the film's count-down to silence.
  const sciLamps: string[] = [];
  for (let i = 0; i < 3; i++) {
    const t = 0.36 + i * 0.28;
    const x = r2(26 + (104 - 26) * t);
    const y = r2(6 + (52 - 6) * t);
    sciLamps.push(
      `      <circle id="lamp-sci-${i + 1}" cx="${x}" cy="${y}" r="3.4" fill="${COLOR.ink}" />`,
    );
  }

  const rtgs: string[] = [];
  for (let i = 0; i < 3; i++) {
    const x = r2(-2 - i * 13);
    const y = r2(30 + i * 17);
    rtgs.push(
      `      <rect id="rtg-${i + 1}" x="${r2(x - 7)}" y="${r2(y - 5)}" width="14" height="10" rx="2" ` +
        `transform="rotate(52 ${x} ${y})" fill="${COLOR.surface}" stroke="${COLOR.ink}" stroke-width="1.2" />`,
    );
  }

  // Three pulses share one path down the thread; the timeline phases them apart.
  const pulses: string[] = [];
  for (let i = 0; i < 3; i++) {
    pulses.push(
      `    <circle id="signal-pulse-${i + 1}" cx="-32" cy="-1" r="3.6" fill="${COLOR.accent}" opacity="0" />`,
    );
  }

  return document_(
    "The craft: the protagonist, on screen in every shot of the film.",
    [
      // The thread is drawn first so every part of the craft paints over it.
      `  <g id="signal-group">`,
      `    <line id="signal-thread" x1="-32" y1="-1" x2="-660" y2="80" stroke="${COLOR.accent}" ` +
        `stroke-width="1.5" opacity="0.5" />`,
      pulses.join("\n"),
      "  </g>",
      '  <g id="probe-body">',
      '    <g id="probe-boom-mag">',
      `      <line x1="18" y1="-14" x2="156" y2="-74" stroke="${COLOR.ink}" stroke-width="1.3" opacity="0.8" />`,
      `      <circle id="lamp-mag-1" cx="156" cy="-74" r="3.4" fill="${COLOR.ink}" />`,
      "    </g>",
      '    <g id="probe-boom-sci">',
      `      <line x1="26" y1="6" x2="104" y2="52" stroke="${COLOR.ink}" stroke-width="1.6" opacity="0.85" />`,
      `      <rect x="58" y="20" width="17" height="13" rx="2" fill="${COLOR.surface}" stroke="${COLOR.ink}" stroke-width="1.2" />`,
      sciLamps.join("\n"),
      "    </g>",
      '    <g id="probe-rtg">',
      `      <line x1="6" y1="14" x2="-30" y2="66" stroke="${COLOR.ink}" stroke-width="1.5" opacity="0.85" />`,
      rtgs.join("\n"),
      `      <circle id="rtg-glow" cx="-16" cy="48" r="21" fill="none" stroke="${accentAlpha(0.32)}" stroke-width="1.4" />`,
      "    </g>",
      '    <g id="probe-bus">',
      `      <path d="M 3 -17 L 21 -17 L 28 -7 L 28 7 L 21 17 L 3 17 Z" fill="${COLOR.surface}" ` +
        `stroke="${COLOR.ink}" stroke-width="1.7" />`,
      `      <line x1="3" y1="-4" x2="28" y2="-4" stroke="${hairline(3)}" stroke-width="1" />`,
      `      <circle id="lamp-radio" cx="14" cy="8" r="3.4" fill="${COLOR.accent}" />`,
      "    </g>",
      '    <g id="probe-record">',
      `      <circle cx="22" cy="24" r="9.5" fill="${COLOR.surface}" stroke="${COLOR.ink}" stroke-width="1.3" />`,
      `      <circle cx="22" cy="24" r="5" fill="none" stroke="${hairline(4)}" stroke-width="0.9" />`,
      `      <circle id="record-glint" cx="22" cy="24" r="2" fill="${COLOR.ink}" opacity="0.9" />`,
      "    </g>",
      '    <g id="probe-dish">',
      `      <path id="dish-face" d="M 0 -52 Q -68 0 0 52 Z" fill="${COLOR.surface}" ` +
        `stroke="${COLOR.ink}" stroke-width="1.9" />`,
      `      <path id="dish-inner" d="M 0 -33 Q -43 0 0 33" fill="none" stroke="${hairline(3.4)}" stroke-width="1.1" />`,
      `      <line id="dish-strut-a" x1="0" y1="-38" x2="-32" y2="-1" stroke="${hairline(3)}" stroke-width="1" />`,
      `      <line id="dish-strut-b" x1="0" y1="38" x2="-32" y2="-1" stroke="${hairline(3)}" stroke-width="1" />`,
      `      <circle id="dish-feed" cx="-32" cy="-1" r="4.2" fill="${COLOR.ink}" />`,
      "    </g>",
      "  </g>",
    ].join("\n"),
  );
}

/** Builds Jupiter: a banded disc whose bands shear against each other, and one turning storm. */
function buildJupiter(): string {
  const bands = [
    { id: "jup-band-1", y: -178, h: 40, alpha: 0.05 },
    { id: "jup-band-2", y: -122, h: 32, alpha: 0.09 },
    { id: "jup-band-3", y: -66, h: 44, alpha: 0.04 },
    { id: "jup-band-4", y: 4, h: 28, alpha: 0.1 },
    { id: "jup-band-5", y: 60, h: 50, alpha: 0.055 },
    { id: "jup-band-6", y: 136, h: 34, alpha: 0.08 },
  ];
  const bandEls = bands.map(
    (band) =>
      `      <rect id="${band.id}" x="-340" y="${band.y}" width="680" height="${band.h}" ` +
      `fill="${inkAlpha(band.alpha)}" />`,
  );

  return document_(
    "Jupiter: the first giant, a banded disc with a storm wider than the Earth.",
    [
      "  <defs>",
      '    <clipPath id="jup-clip">',
      '      <circle cx="0" cy="0" r="238" />',
      "    </clipPath>",
      // The sun is off to frame left all film, so the far limb falls away smoothly to the right.
      '    <linearGradient id="jup-shade" x1="0%" y1="0%" x2="100%" y2="0%">',
      `      <stop offset="0%" stop-color="${COLOR.canvas}" stop-opacity="0" />`,
      `      <stop offset="52%" stop-color="${COLOR.canvas}" stop-opacity="0.16" />`,
      `      <stop offset="100%" stop-color="${COLOR.canvas}" stop-opacity="0.72" />`,
      "    </linearGradient>",
      "  </defs>",
      '  <g id="jupiter-body">',
      `    <circle id="jup-disc" cx="0" cy="0" r="238" fill="${COLOR.surface}" />`,
      '    <g clip-path="url(#jup-clip)">',
      bandEls.join("\n"),
      `      <ellipse id="jup-spot" cx="-104" cy="-96" rx="58" ry="32" fill="${accentAlpha(0.42)}" />`,
      `      <ellipse id="jup-spot-core" cx="-104" cy="-96" rx="27" ry="15" fill="${accentAlpha(0.68)}" />`,
      `      <rect id="jup-terminator" x="-240" y="-240" width="480" height="480" fill="url(#jup-shade)" />`,
      "    </g>",
      `    <circle id="jup-limb" cx="0" cy="0" r="238" fill="none" stroke="${inkAlpha(0.3)}" stroke-width="1.6" />`,
      "  </g>",
    ].join("\n"),
  );
}

/** Builds Saturn and Titan: rings that draw themselves on, and the moon that ends the tour. */
function buildSaturn(): string {
  // Rings are two halves of the same ellipse so the planet can sit between them.
  const ringSpec = [
    { name: "outer", rx: 336, ry: 78, alpha: 0.3 },
    { name: "mid", rx: 296, ry: 68, alpha: 0.2 },
    { name: "inner", rx: 252, ry: 58, alpha: 0.26 },
  ];
  const back = ringSpec.map(
    (ring) =>
      `      <path id="sat-ring-back-${ring.name}" d="M ${-ring.rx} 0 A ${ring.rx} ${ring.ry} 0 0 1 ${ring.rx} 0" ` +
      `fill="none" stroke="${inkAlpha(ring.alpha)}" stroke-width="2" />`,
  );
  const front = ringSpec.map(
    (ring) =>
      `      <path id="sat-ring-front-${ring.name}" d="M ${ring.rx} 0 A ${ring.rx} ${ring.ry} 0 0 1 ${-ring.rx} 0" ` +
      `fill="none" stroke="${inkAlpha(ring.alpha)}" stroke-width="2" />`,
  );

  return document_(
    "Saturn and Titan: the encounter that ended the tour and turned the craft outward.",
    [
      "  <defs>",
      '    <clipPath id="sat-clip">',
      '      <circle cx="0" cy="0" r="172" />',
      "    </clipPath>",
      "  </defs>",
      '  <g id="saturn-body">',
      '    <g id="sat-rings-back" transform="rotate(-13)">',
      back.join("\n"),
      "    </g>",
      `    <circle id="sat-disc" cx="0" cy="0" r="172" fill="${COLOR.surface}" />`,
      '    <g clip-path="url(#sat-clip)">',
      `      <rect id="sat-band-1" x="-200" y="-96" width="400" height="34" fill="${inkAlpha(0.12)}" />`,
      `      <rect id="sat-band-2" x="-200" y="-24" width="400" height="26" fill="${inkAlpha(0.16)}" />`,
      `      <rect id="sat-band-3" x="-200" y="46" width="400" height="40" fill="${inkAlpha(0.1)}" />`,
      "    </g>",
      `    <circle id="sat-limb" cx="0" cy="0" r="172" fill="none" stroke="${inkAlpha(0.32)}" stroke-width="1.8" />`,
      '    <g id="sat-rings-front" transform="rotate(-13)">',
      front.join("\n"),
      "    </g>",
      "  </g>",
      '  <g id="titan-body" transform="translate(246, 162)">',
      `    <circle id="titan-haze" cx="0" cy="0" r="42" fill="${accentAlpha(0.16)}" />`,
      `    <circle id="titan-haze-ring" cx="0" cy="0" r="42" fill="none" stroke="${accentAlpha(0.5)}" stroke-width="1.4" />`,
      `    <circle id="titan-disc" cx="0" cy="0" r="27" fill="${COLOR.surface}" stroke="${COLOR.ink}" stroke-width="1.5" />`,
      "  </g>",
    ].join("\n"),
  );
}

/** Builds the sixty frame survey: a grid of empty plates that fill in as the pictures are taken. */
function buildSurvey(): string {
  const cols = 10;
  const rows = 6;
  const cellW = 58;
  const cellH = 42;
  const gap = 9;
  const totalW = cols * cellW + (cols - 1) * gap;
  const totalH = rows * cellH + (rows - 1) * gap;
  const x0 = -totalW / 2;
  const y0 = -totalH / 2;

  const cells: string[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const x = r2(x0 + col * (cellW + gap));
      const y = r2(y0 + row * (cellH + gap));
      cells.push(
        `      <rect id="survey-cell-${index}" x="${x}" y="${y}" width="${cellW}" height="${cellH}" ` +
          `fill="${inkAlpha(0.07)}" stroke="${hairline(2.2)}" stroke-width="1" opacity="0" />`,
      );
    }
  }

  // The one plate that matters is marked from the start, so the reveal has somewhere to land.
  const markCol = 6;
  const markRow = 3;
  const markX = r2(x0 + markCol * (cellW + gap));
  const markY = r2(y0 + markRow * (cellH + gap));

  return document_(
    "The survey: sixty frames taken looking back, and the one that caught a sunbeam.",
    [
      '  <g id="survey-body">',
      '    <g id="survey-cells">',
      cells.join("\n"),
      "    </g>",
      `    <rect id="survey-mark" x="${markX}" y="${markY}" width="${cellW}" height="${cellH}" ` +
        `fill="none" stroke="${COLOR.accent}" stroke-width="2" opacity="0" />`,
      `    <line id="survey-sweep" x1="${r2(x0 - 14)}" y1="${r2(y0 - 22)}" x2="${r2(x0 - 14)}" y2="${r2(y0 + totalH + 22)}" ` +
        `stroke="${accentAlpha(0.55)}" stroke-width="1.6" opacity="0" />`,
      "  </g>",
    ].join("\n"),
  );
}

/** Builds the photographic plate: scattered sunlight across the frame, and one pale blue speck. */
function buildPlate(): string {
  const scanlines: string[] = [];
  for (let i = 0; i < 22; i++) {
    const y = r2(-206 + i * 19);
    scanlines.push(
      `      <line x1="-346" y1="${y}" x2="346" y2="${y}" stroke="${hairline(0.5)}" stroke-width="1" />`,
    );
  }

  return document_(
    "The plate: the frame that caught the Earth by accident, inside a stray beam of sunlight.",
    [
      "  <defs>",
      '    <linearGradient id="beam-grad" x1="0%" y1="0%" x2="100%" y2="0%">',
      `      <stop offset="0%" stop-color="${COLOR.ink}" stop-opacity="0" />`,
      `      <stop offset="42%" stop-color="${COLOR.ink}" stop-opacity="0.2" />`,
      `      <stop offset="72%" stop-color="${COLOR.ink}" stop-opacity="0.1" />`,
      `      <stop offset="100%" stop-color="${COLOR.ink}" stop-opacity="0" />`,
      "    </linearGradient>",
      "  </defs>",
      '  <g id="plate-body">',
      `    <rect id="plate-ground" x="-348" y="-216" width="696" height="432" fill="${COLOR.canvas}" ` +
        `stroke="${hairline(2.6)}" stroke-width="1.4" />`,
      '    <g id="plate-scanlines">',
      scanlines.join("\n"),
      "    </g>",
      `    <path id="beam-wide" d="M -348 -206 L 348 -84 L 348 26 L -348 -96 Z" fill="url(#beam-grad)" />`,
      `    <path id="beam-narrow" d="M -348 -160 L 348 -48 L 348 -14 L -348 -126 Z" fill="url(#beam-grad)" opacity="0.8" />`,
      '    <g id="speck-group">',
      `      <circle id="speck-halo" cx="96" cy="-46" r="17" fill="none" stroke="${accentAlpha(0.4)}" stroke-width="1.2" />`,
      `      <circle id="speck" cx="96" cy="-46" r="4.4" fill="${COLOR.accent}" />`,
      "    </g>",
      '    <g id="reticle">',
      `      <path id="reticle-tl" d="M 30 -112 L 30 -134 M 30 -134 L 52 -134" fill="none" stroke="${inkAlpha(0.6)}" stroke-width="1.6" />`,
      `      <path id="reticle-tr" d="M 162 -134 L 162 -112 M 140 -134 L 162 -134" fill="none" stroke="${inkAlpha(0.6)}" stroke-width="1.6" />`,
      `      <path id="reticle-bl" d="M 30 20 L 30 42 M 30 42 L 52 42" fill="none" stroke="${inkAlpha(0.6)}" stroke-width="1.6" />`,
      `      <path id="reticle-br" d="M 162 42 L 162 20 M 140 42 L 162 42" fill="none" stroke="${inkAlpha(0.6)}" stroke-width="1.6" />`,
      "    </g>",
      "  </g>",
    ].join("\n"),
  );
}

/** Builds the heliopause: the boundary arc, the wind that stops at it, and what waits outside. */
function buildBoundary(): string {
  const rand = mulberry32(20120825);

  // Solar wind: short streamers on the inside, all pointing outward along the craft's heading.
  const wind: string[] = [];
  for (let i = 0; i < 14; i++) {
    const x = r2(-300 + rand() * 270);
    const y = r2(-190 + rand() * 380);
    const len = r2(16 + rand() * 26);
    wind.push(
      `      <line id="wind-${i + 1}" x1="${x}" y1="${y}" x2="${r2(x + len)}" y2="${y}" ` +
        `stroke="${inkAlpha(0.34)}" stroke-width="1.4" />`,
    );
  }

  // Interstellar medium: denser, colder, unordered. Dots rather than streamers.
  const ism: string[] = [];
  for (let i = 0; i < 34; i++) {
    const x = r2(40 + rand() * 280);
    const y = r2(-196 + rand() * 392);
    ism.push(
      `      <circle id="ism-${i + 1}" cx="${x}" cy="${y}" r="${r2(1.4 + rand() * 1.6)}" ` +
        `fill="${COLOR.ink}" opacity="0" />`,
    );
  }

  return document_(
    "The heliopause: where the sun's breath stops and something colder begins.",
    [
      '  <g id="boundary-body">',
      '    <g id="wind-field">',
      wind.join("\n"),
      "    </g>",
      '    <g id="ism-field">',
      ism.join("\n"),
      "    </g>",
      `    <path id="bubble-arc" d="M 30 -420 C 170 -240, 170 240, 30 420" fill="none" ` +
        `stroke="${inkAlpha(0.42)}" stroke-width="2.4" />`,
      `    <path id="bubble-arc-inner" d="M -6 -404 C 130 -230, 130 230, -6 404" fill="none" ` +
        `stroke="${accentAlpha(0.3)}" stroke-width="1.4" />`,
      "  </g>",
    ].join("\n"),
  );
}

/** Builds the golden record: one continuous groove, and the map that says where it came from. */
function buildRecord(): string {
  // A single Archimedean spiral drawn as one path, which is what lets it draw itself on in one line.
  const turns = 16;
  const rOuter = 132;
  const rInner = 30;
  const steps = turns * 72;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const radius = rOuter - (rOuter - rInner) * t;
    points.push(`${r2(Math.cos(angle) * radius)} ${r2(Math.sin(angle) * radius)}`);
  }
  const groove = `M ${points[0]} L ${points.slice(1).join(" L ")}`;

  // The pulsar map: rays of different lengths radiating from one point, as etched on the cover.
  const rays: string[] = [];
  const rand = mulberry32(1977);
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + 0.2;
    const len = 46 + rand() * 66;
    rays.push(
      `      <line id="pulsar-ray-${i + 1}" x1="0" y1="0" x2="${r2(Math.cos(angle) * len)}" ` +
        `y2="${r2(Math.sin(angle) * len)}" stroke="${inkAlpha(0.55)}" stroke-width="1.2" />`,
    );
  }

  return document_(
    "The golden record: the lunch they packed for a craft that was never coming back.",
    [
      "  <defs>",
      '    <clipPath id="rec-clip">',
      '      <circle cx="0" cy="0" r="144" />',
      "    </clipPath>",
      "  </defs>",
      '  <g id="record-body">',
      `    <circle id="rec-disc" cx="0" cy="0" r="144" fill="${COLOR.surface}" stroke="${COLOR.ink}" stroke-width="1.8" />`,
      `    <path id="rec-groove" d="${groove}" fill="none" stroke="${inkAlpha(0.26)}" stroke-width="0.9" />`,
      `    <circle id="rec-label" cx="0" cy="0" r="30" fill="${COLOR.canvas}" stroke="${hairline(3)}" stroke-width="1.1" />`,
      `    <circle id="rec-hole" cx="0" cy="0" r="7" fill="${COLOR.canvas}" stroke="${inkAlpha(0.45)}" stroke-width="1.1" />`,
      '    <g id="rec-pulsar-map" transform="translate(0, 0)">',
      rays.join("\n"),
      `      <circle id="pulsar-origin" cx="0" cy="0" r="4" fill="${COLOR.accent}" />`,
      "    </g>",
      '    <g clip-path="url(#rec-clip)">',
      `      <path id="rec-sheen" d="M -230 -190 L -150 -190 L 70 190 L -10 190 Z" fill="${COLOR.ink}" opacity="0.07" />`,
      "    </g>",
      "  </g>",
    ].join("\n"),
  );
}

/** Builds the scrim: a plain darkening plate the timeline lifts under every text card. */
function buildScrim(): string {
  return document_(
    "The scrim: a darkening plate raised under on-screen text so the film stays readable.",
    [
      `  <rect id="scrim-fill" x="-320" y="-220" width="640" height="440" fill="${COLOR.canvas}" opacity="0" />`,
    ].join("\n"),
  );
}

/** Every asset of the film, keyed by the file name it is written to under visuals/. */
export function buildAllArtwork(): Record<string, string> {
  return {
    "space.svg": buildSpace(),
    "stars-far.svg": buildStarField({
      id: "stars-far",
      description: "The deep star field: the slowest layer, and the one that never stops moving.",
      seed: 19770905,
      count: 185,
      xMin: -240,
      xMax: 560,
      yExtent: 214,
      radiusMin: 0.5,
      radiusMax: 1.15,
      opacityMin: 0.12,
      opacityMax: 0.42,
      twinkles: 8,
    }),
    "stars-near.svg": buildStarField({
      id: "stars-near",
      description: "The near star field: brighter, faster, and what sells the forward motion.",
      seed: 20120825,
      count: 112,
      xMin: -300,
      xMax: 1500,
      yExtent: 284,
      radiusMin: 0.8,
      radiusMax: 1.9,
      opacityMin: 0.28,
      opacityMax: 0.74,
      twinkles: 6,
    }),
    "sun.svg": buildSun(),
    "home-system.svg": buildHomeSystem(),
    "probe.svg": buildProbe(),
    "jupiter.svg": buildJupiter(),
    "saturn.svg": buildSaturn(),
    "survey.svg": buildSurvey(),
    "plate.svg": buildPlate(),
    "boundary.svg": buildBoundary(),
    "record.svg": buildRecord(),
    "scrim.svg": buildScrim(),
  };
}
