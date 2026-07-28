import type { Episode } from "../schema";

/**
 * ---------------------------------------------------------------------------
 * EPISODE: why leaves are green
 * ---------------------------------------------------------------------------
 * Pure data. The only import is a type, which the compiler erases, so this file
 * has zero runtime dependencies — that is what lets the storyboard generator
 * read it from plain Node without booting fonts, React or Remotion.
 *
 * This is exactly the shape a generator stage should emit. Nothing about *look*
 * lives here beyond named intent (accent role, camera, subject state); nothing
 * about timing lives in the renderer.
 */
export const leavesEpisode: Episode = {
  id: "leaves",
  title: "Why are most leaves green?",
  subtitle: "Chlorophyll, anthocyanin, and the cost of colour",
  fps: 30,
  // For this episode primary reads as chlorophyll green and secondary as
  // anthocyanin purple — but that mapping lives in the theme pack, not here.
  subject: "leaf",
  theme: "botanical",
  endTag: "Chlorophyll · Anthocyanin",
  audio: { src: "audio.mp3", trimBefore: 6 },

  scenes: [
    {
      id: "hook",
      start: 0,
      duration: 4,
      kicker: "PLANT PIGMENTS",
      headline: "Almost every leaf you've ever seen is *green*.",
      accent: "primary",
      camera: { distance: 8.2, yaw: -0.38, pitch: 0.14 },
      subjectState: 0,
    },
    {
      id: "anomaly",
      start: 4,
      duration: 4,
      headline: "A few are deep purple. Some are nearly *black*.",
      accent: "secondary",
      camera: { distance: 7.1, yaw: 0.48, pitch: -0.06 },
      subjectState: 1,
      wash: true,
    },
    {
      id: "question",
      start: 8,
      duration: 3,
      headline: "_Why?_",
      body: "Same sunlight. Same job. Different colour.",
      accent: "neutral",
      camera: { distance: 12.4, yaw: 0.08, pitch: 0.3 },
      subjectState: 1,
    },
    {
      id: "chlorophyll",
      start: 11,
      duration: 7,
      kicker: "CHLOROPHYLL",
      headline: "Leaves are green because of *chlorophyll*.",
      body: "Chlorophyll a and chlorophyll b are the molecules that catch sunlight and run photosynthesis.",
      accent: "primary",
      camera: { distance: 9.4, yaw: -0.56, pitch: 0.18 },
      subjectState: 0,
      wash: true,
    },
    {
      id: "spectrum",
      start: 18,
      duration: 8,
      kicker: "ABSORPTION",
      headline: "It absorbs blue and red — and *reflects the rest*.",
      body: "The light chlorophyll cannot use bounces back out of the leaf. That leftover band is green.",
      accent: "primary",
      visual: "spectrum",
      camera: { distance: 14.6, yaw: -0.18, pitch: 0.04 },
      subjectState: 0,
    },
    {
      id: "mask",
      start: 26,
      duration: 8,
      kicker: "ANTHOCYANIN",
      headline: "Purple leaves are *not* missing chlorophyll.",
      body: "They are full of it. A second pigment — anthocyanin — sits on top and hides the green underneath.",
      accent: "secondary",
      camera: { distance: 8.1, yaw: 0.46, pitch: -0.1 },
      subjectState: 1,
      wash: true,
    },
    {
      id: "anthocyanin",
      start: 34,
      duration: 7,
      kicker: "FLAVONOIDS",
      headline: "One molecule, *three colours*.",
      body: "Anthocyanins are flavonoids. Their colour depends on how acidic the sap around them is.",
      accent: "secondary",
      visual: "chips",
      chips: [
        { label: "Red", sub: "acidic  pH < 3", color: "#FF7A7A" },
        { label: "Purple", sub: "neutral  pH ≈ 7", color: "#B77BFF" },
        { label: "Blue", sub: "alkaline  pH > 11", color: "#6FB1FF" },
      ],
      camera: { distance: 10.6, yaw: -0.3, pitch: 0.22 },
      subjectState: 1,
    },
    {
      id: "benefits",
      start: 41,
      duration: 9,
      kicker: "WHY PAY FOR IT",
      headline: "The pigment is a *defence system*.",
      accent: "secondary",
      visual: "bullets",
      bullets: [
        { title: "Sunscreen", sub: "Absorbs UV before it reaches the chloroplasts" },
        { title: "Antioxidant", sub: "Neutralises the reactive oxygen stress creates" },
        { title: "Cold tolerance", sub: "Protects the leaf through frost and drought" },
        { title: "Deterrent", sub: "Signals low food value to insects and grazers" },
      ],
      camera: { distance: 11.2, yaw: 0.62, pitch: 0.1 },
      subjectState: 1,
    },
    {
      id: "tradeoff",
      start: 50,
      duration: 6,
      kicker: "THE TRADE-OFF",
      headline: "So why isn't *everything* purple?",
      body: "Anthocyanin costs energy to build, and it blocks light chlorophyll could have harvested.",
      accent: "neutral",
      camera: { distance: 8.9, yaw: -0.14, pitch: -0.16 },
      // Half green, half purple — the split leaf is the argument. Slightly under
      // 0.5 because the blade's widest part is low, so an even UV split reads
      // top-heavy on screen.
      subjectState: 0.42,
      wash: true,
    },
    {
      id: "endcard",
      start: 56,
      duration: 4,
      // Both pigments named, each in its own colour, mirroring the split leaf.
      headline: "*Green* is the default.\n~Purple~ is the insurance policy.",
      accent: "primary",
      visual: "endcard",
      camera: { distance: 13.2, yaw: 0.06, pitch: 0.32 },
      // Centre the leaf for the closing shot; the copy sits below it.
      subjectScreen: { x: 0.5, y: 0.33 },
      subjectState: 0.46,
    },
  ],
};
