/**
 * File Description: Starter SVG animation templates for the Aideos Motion stage.
 * Each template is self-contained, scrub-exact SMIL animation so the studio's scrubber shows the
 * frame that will actually render. They exist so a user never faces an empty code box: every one is
 * a working animation that can be edited into something specific.
 */

export interface MotionTemplate {
  id: string;
  label: string;
  description: string;
  durationSec: number;
  svg: string;
}

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: "pulse-node",
    label: "Pulsing node",
    description: "A single concept node breathing on a hairline grid. Good for an anchor beat.",
    durationSec: 2.4,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
  <rect width="480" height="270" fill="#0A0A0B"/>
  <g stroke="#F5F5F5" stroke-opacity="0.1">
    <path d="M0 135H480M240 0V270"/>
  </g>
  <circle cx="240" cy="135" r="28" fill="none" stroke="#635BFF" stroke-width="3">
    <animate attributeName="r" values="28;54;28" dur="2.4s" repeatCount="indefinite"/>
    <animate attributeName="stroke-opacity" values="1;0.15;1" dur="2.4s" repeatCount="indefinite"/>
  </circle>
  <circle cx="240" cy="135" r="10" fill="#635BFF"/>
  <text x="240" y="200" fill="#F5F5F5" font-family="monospace" font-size="14" text-anchor="middle">node</text>
</svg>`,
  },
  {
    id: "draw-path",
    label: "Draw-on path",
    description: "A stroke that writes itself in, for showing a connection or a flow being made.",
    durationSec: 3,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
  <rect width="480" height="270" fill="#0A0A0B"/>
  <path d="M60 210 C 160 210, 160 60, 240 60 S 320 210, 420 210"
        fill="none" stroke="#635BFF" stroke-width="4" stroke-linecap="round"
        stroke-dasharray="620" stroke-dashoffset="620">
    <animate attributeName="stroke-dashoffset" from="620" to="0" dur="3s" fill="freeze"/>
  </path>
  <circle r="7" fill="#F5F5F5">
    <animateMotion dur="3s" fill="freeze"
      path="M60 210 C 160 210, 160 60, 240 60 S 320 210, 420 210"/>
  </circle>
</svg>`,
  },
  {
    id: "bar-grow",
    label: "Bars growing",
    description: "Four bars rising in sequence. Use it when a number needs to land visually.",
    durationSec: 2,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
  <rect width="480" height="270" fill="#0A0A0B"/>
  <g fill="#635BFF">
    <rect x="90" y="210" width="48" height="0">
      <animate attributeName="height" from="0" to="60" dur="0.6s" begin="0s" fill="freeze"/>
      <animate attributeName="y" from="210" to="150" dur="0.6s" begin="0s" fill="freeze"/>
    </rect>
    <rect x="170" y="210" width="48" height="0">
      <animate attributeName="height" from="0" to="110" dur="0.6s" begin="0.35s" fill="freeze"/>
      <animate attributeName="y" from="210" to="100" dur="0.6s" begin="0.35s" fill="freeze"/>
    </rect>
    <rect x="250" y="210" width="48" height="0">
      <animate attributeName="height" from="0" to="150" dur="0.6s" begin="0.7s" fill="freeze"/>
      <animate attributeName="y" from="210" to="60" dur="0.6s" begin="0.7s" fill="freeze"/>
    </rect>
    <rect x="330" y="210" width="48" height="0">
      <animate attributeName="height" from="0" to="185" dur="0.6s" begin="1.05s" fill="freeze"/>
      <animate attributeName="y" from="210" to="25" dur="0.6s" begin="1.05s" fill="freeze"/>
    </rect>
  </g>
  <path d="M70 210H410" stroke="#F5F5F5" stroke-opacity="0.3" stroke-width="2"/>
</svg>`,
  },
  {
    id: "orbit-cluster",
    label: "Orbiting cluster",
    description: "Satellites circling a core, for embeddings, clusters or distributed systems.",
    durationSec: 4,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
  <rect width="480" height="270" fill="#0A0A0B"/>
  <circle cx="240" cy="135" r="90" fill="none" stroke="#F5F5F5" stroke-opacity="0.12" stroke-width="2"/>
  <circle cx="240" cy="135" r="18" fill="#635BFF"/>
  <g>
    <animateTransform attributeName="transform" type="rotate"
      from="0 240 135" to="360 240 135" dur="4s" repeatCount="indefinite"/>
    <circle cx="330" cy="135" r="9" fill="#F5F5F5"/>
    <circle cx="150" cy="135" r="9" fill="#F5F5F5"/>
  </g>
  <g>
    <animateTransform attributeName="transform" type="rotate"
      from="90 240 135" to="450 240 135" dur="6s" repeatCount="indefinite"/>
    <circle cx="240" cy="45" r="7" fill="#8A8A8E"/>
  </g>
</svg>`,
  },
  {
    id: "type-on",
    label: "Terminal type-on",
    description: "Text revealed character by character with a blinking caret, for code beats.",
    durationSec: 3.2,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
  <rect width="480" height="270" fill="#0A0A0B"/>
  <rect x="40" y="95" width="400" height="80" fill="#101013" stroke="#F5F5F5" stroke-opacity="0.1"/>
  <clipPath id="typeMask">
    <rect x="60" y="110" width="0" height="50">
      <animate attributeName="width" from="0" to="360" dur="2.4s" fill="freeze"/>
    </rect>
  </clipPath>
  <text x="60" y="145" fill="#F5F5F5" font-family="monospace" font-size="20" clip-path="url(#typeMask)">
    attention(q, k, v)
  </text>
  <rect y="126" width="10" height="22" fill="#635BFF">
    <animate attributeName="x" from="60" to="420" dur="2.4s" fill="freeze"/>
    <animate attributeName="opacity" values="1;0;1" dur="0.8s" repeatCount="indefinite"/>
  </rect>
</svg>`,
  },
  {
    id: "split-compare",
    label: "Split comparison",
    description: "Two panels sliding apart to compare an old approach with a new one.",
    durationSec: 2.6,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
  <rect width="480" height="270" fill="#0A0A0B"/>
  <g>
    <rect x="120" y="60" width="150" height="150" fill="#101013" stroke="#8A8A8E" stroke-width="2"/>
    <animateTransform attributeName="transform" type="translate" from="0 0" to="-75 0" dur="1.2s" fill="freeze"/>
  </g>
  <g>
    <rect x="210" y="60" width="150" height="150" fill="#101013" stroke="#635BFF" stroke-width="3"/>
    <animateTransform attributeName="transform" type="translate" from="0 0" to="75 0" dur="1.2s" fill="freeze"/>
  </g>
  <text x="120" y="238" fill="#8A8A8E" font-family="monospace" font-size="13" text-anchor="middle">before</text>
  <text x="360" y="238" fill="#635BFF" font-family="monospace" font-size="13" text-anchor="middle">after</text>
</svg>`,
  },
];
