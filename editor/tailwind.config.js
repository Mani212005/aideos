/**
 * File Description: Tailwind theme for the Aideos editor chrome.
 * Maps every utility the editor uses onto the Neobrutalism design tokens declared in
 * src/styles/tokens.css so no component ever hard-codes a hex value. The editor is light end to
 * end; the single dark token is `matte`, reserved for the area directly behind the video frame.
 * This theme styles the editor UI only - the rendered video design language in src/dl is
 * deliberately untouched.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
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
        /* Near-black used for every border, hard shadow and primary text */
        ink: "var(--nb-ink)",
        "ink-soft": "var(--nb-ink-soft)",
        "ink-mute": "var(--nb-ink-mute)",
        /* Role accents */
        primary: "var(--nb-primary)",
        select: "var(--nb-select)",
        "select-ink": "var(--nb-select-ink)",
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
        DEFAULT: "0",
      },
      borderWidth: {
        3: "3px",
      },
      boxShadow: {
        "nb-xs": "1px 1px 0 0 var(--nb-ink)",
        "nb-sm": "2px 2px 0 0 var(--nb-ink)",
        nb: "4px 4px 0 0 var(--nb-ink)",
        "nb-lg": "6px 6px 0 0 var(--nb-ink)",
        "nb-xl": "10px 10px 0 0 var(--nb-ink)",
        "nb-inset": "inset 0 0 0 2px var(--nb-ink)",
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
        "nb-blink": "nb-blink 900ms steps(1, end) infinite",
      },
    },
  },
  plugins: [],
};
