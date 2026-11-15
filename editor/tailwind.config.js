/**
 * File Description: Tailwind theme for the Aideos editor chrome.
 * Maps every utility the editor uses onto the design tokens declared in
 * src/styles/tokens.css so no component ever hard-codes a hex value. The editor is light end to
 * end; the single dark token is `matte`, reserved for the area directly behind the video frame.
 * This theme styles the editor UI only - the rendered video design language in src/dl is
 * deliberately untouched.
 * Inputs and outputs: token definitions and content paths -> Tailwind CSS utility configuration.
 * Used by: PostCSS and Tailwind build process.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    /* The type scale: 12 / 13 / 15 / 20 / 28 px. Nothing else is a text size. */
    fontSize: {
      xs: ["var(--nb-text-xs)", { lineHeight: "1.4" }],
      sm: ["var(--nb-text-sm)", { lineHeight: "1.45" }],
      base: ["var(--nb-text-base)", { lineHeight: "1.5" }],
      lg: ["var(--nb-text-lg)", { lineHeight: "1.3" }],
      xl: ["var(--nb-text-xl)", { lineHeight: "1.2" }],
    },
    extend: {
      colors: {
        /* Chrome: app frame, panels, toolbars, modals */
        paper: "var(--nb-paper)",
        "paper-2": "var(--nb-paper-2)",
        "paper-3": "var(--nb-paper-3)",
        /* Recessed working surfaces: timeline canvas, lane gutters, script ground */
        sunken: "var(--nb-sunken)",
        "sunken-2": "var(--nb-sunken-2)",
        "sunken-3": "var(--nb-sunken-3)",
        /* The one dark surface: matte directly behind the video frame */
        matte: "var(--nb-matte)",
        "matte-text": "var(--nb-matte-text)",
        /* Near-black used for primary text */
        ink: "var(--nb-ink)",
        "ink-soft": "var(--nb-ink-soft)",
        "ink-mute": "var(--nb-ink-mute)",
        /* The one border colour */
        line: "var(--nb-line)",
        /* The one accent, and the role colours */
        primary: "var(--nb-primary)",
        select: "var(--nb-select)",
        "select-ink": "var(--nb-select-ink)",
        "select-tint": "var(--nb-select-tint)",
        "select-text": "var(--nb-select-text)",
        "danger-text": "var(--nb-danger-text)",
        success: "var(--nb-success)",
        danger: "var(--nb-danger)",
        warn: "var(--nb-warn)",
        info: "var(--nb-info)",
        /* Timeline clip bodies */
        "clip-anim": "var(--nb-clip-anim)",
        "clip-video": "var(--nb-clip-video)",
        "clip-audio": "var(--nb-clip-audio)",
        "clip-text": "var(--nb-clip-text)",
        "clip-subtitle": "var(--nb-clip-subtitle)",
        "clip-image": "var(--nb-clip-image)",
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        none: "0",
        DEFAULT: "var(--nb-radius)",
      },
      /* The only shadow: one 1 px shadow under the picture. */
      boxShadow: {
        frame: "var(--nb-shadow-frame)",
        none: "none",
      },
      transitionTimingFunction: {
        nb: "var(--nb-ease)",
      },
      transitionDuration: {
        nb: "var(--nb-dur)",
      },
      keyframes: {
        "nb-marquee": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "28px 0" },
        },
        "nb-blink": {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0.3" },
        },
      },
      animation: {
        "nb-marquee": "nb-marquee 600ms linear infinite",
        "nb-blink": "nb-blink 1200ms var(--nb-ease) infinite",
      },
    },
  },
  plugins: [],
};
