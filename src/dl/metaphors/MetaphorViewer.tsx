import React from "react";
import { MONO } from "../tokens";
import { GlowingClusterMetaphor } from "./GlowingClusterMetaphor";

export interface MetaphorProps {
  type: "typing-cursor-quote" | "spider-web" | "liquid-bucket" | "balance-scale" | "clock-gears" | "rocket-launch" | "character-throw" | "glowing-cluster" | "custom";
  frame: number;
  accent?: string;
  fontFamily?: string;
}

// 1. Procedural Spider Web Weaving Animation
export const SpiderWebAnimation: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const radials = 8;
  const spirals = 6;
  const progress = Math.min(1, frame / 90);

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg width="600" height="600" viewBox="-300 -300 600 600" className="overflow-visible">
        {/* Radial Spokes */}
        {Array.from({ length: radials }).map((_, i) => {
          const angle = (i * 2 * Math.PI) / radials;
          const r = 240 * Math.min(1, progress * 1.5);
          const x2 = Math.cos(angle) * r;
          const y2 = Math.sin(angle) * r;
          return (
            <line
              key={`spoke-${i}`}
              x1={0}
              y1={0}
              x2={x2}
              y2={y2}
              stroke={accent}
              strokeWidth={2}
              strokeOpacity={0.6}
            />
          );
        })}

        {/* Concentric Spiral Connections */}
        {Array.from({ length: spirals }).map((_, s) => {
          const radius = 40 + s * 35;
          const sProgress = Math.max(0, Math.min(1, (progress - (s * 0.12)) / 0.3));
          if (sProgress <= 0) return null;

          const points = Array.from({ length: radials + 1 }).map((_, r) => {
            const angle = (r * 2 * Math.PI) / radials;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            return `${x},${y}`;
          }).join(" ");

          return (
            <polyline
              key={`spiral-${s}`}
              points={points}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={1.8}
              strokeOpacity={0.75 * sProgress}
              strokeDasharray="4,3"
            />
          );
        })}

        {/* The Animated Spider Centroid */}
        <g transform={`translate(${Math.cos(frame * 0.08) * 120 * (1 - progress)}, ${Math.sin(frame * 0.08) * 120 * (1 - progress)})`}>
          <circle r={10} fill={accent} className="drop-shadow-lg" />
          <circle r={16} fill="none" stroke={accent} strokeWidth={2} opacity={0.4} />
          {/* Spider Legs */}
          {[-1, 1].map((side) =>
            [0, 1, 2, 3].map((leg) => {
              const angle = side * (0.4 + leg * 0.3) + Math.sin(frame * 0.3 + leg) * 0.2;
              const lx = Math.cos(angle) * (20 + leg * 3);
              const ly = Math.sin(angle) * (20 + leg * 3);
              return (
                <line
                  key={`leg-${side}-${leg}`}
                  x1={0}
                  y1={0}
                  x2={lx}
                  y2={ly}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })
          )}
        </g>
      </svg>

      <div className="absolute bottom-10 px-4 py-2 rounded-full bg-black/60 backdrop-blur border border-white/20 text-white font-mono text-xs">
        🕸️ Procedural Weaving · Radial Connections Active
      </div>
    </div>
  );
};

// 2. Liquid Container / Reservoir Simulation
export const LiquidContainerAnimation: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const fillHeight = Math.min(260, (frame / 120) * 260);
  const waveOffset = Math.sin(frame * 0.15) * 8;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      <div className="relative w-72 h-80 border-4 border-white/40 rounded-b-3xl overflow-hidden bg-black/40 shadow-2xl flex flex-col justify-end p-2">
        {/* Liquid Fill */}
        <div
          className="w-full rounded-b-2xl transition-all relative overflow-hidden"
          style={{
            height: `${fillHeight}px`,
            background: `linear-gradient(180deg, ${accent} 0%, rgba(20,20,30,0.95) 100%)`,
          }}
        >
          {/* Animated Wave Top */}
          <div
            className="absolute top-0 left-0 right-0 h-4 bg-white/30"
            style={{ transform: `translateY(${waveOffset}px)` }}
          />
        </div>

        {/* Measurement Grid Lines */}
        <div className="absolute inset-y-4 right-4 flex flex-col justify-between text-[10px] font-mono text-gray-400 select-none pointer-events-none">
          <span>100% (128k)</span>
          <span>75% (96k)</span>
          <span>50% (64k)</span>
          <span>25% (32k)</span>
          <span>0%</span>
        </div>
      </div>

      <div className="mt-4 px-4 py-1.5 rounded bg-black/60 border border-white/10 text-xs font-mono text-gray-200">
        🚰 Dynamic Buffer Allocation: <span style={{ color: accent }}>{Math.round((fillHeight / 260) * 100)}%</span>
      </div>
    </div>
  );
};

// 3. Balance Scale Metaphor
export const BalanceScaleAnimation: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const tiltAngle = Math.sin(frame * 0.05) * 14;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      <svg width="500" height="360" viewBox="-250 -180 500 360" className="overflow-visible">
        {/* Central Stand */}
        <line x1={0} y1={-120} x2={0} y2={120} stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" />
        <path d="M-60 120 L60 120 L40 140 L-40 140 Z" fill="#333338" />

        {/* Pivot Point */}
        <circle cx={0} cy={-120} r={8} fill={accent} />

        {/* Rotating Lever Beam */}
        <g transform={`rotate(${tiltAngle} 0 -120)`}>
          <line x1={-180} y1={-120} x2={180} y2={-120} stroke="#FFFFFF" strokeWidth={5} />
          
          {/* Left Pan: Compute */}
          <line x1={-180} y1={-120} x2={-180} y2={-40} stroke="rgba(255,255,255,0.4)" strokeWidth={2} />
          <path d="M-220 -40 Q-180 -10 -140 -40 Z" fill="#222" stroke="#666" strokeWidth={2} />
          <text x={-180} y={-55} fill="#FFF" fontSize="11" fontFamily={MONO} textAnchor="middle">Compute Cost</text>

          {/* Right Pan: Memory */}
          <line x1={180} y1={-120} x2={180} y2={-40} stroke="rgba(255,255,255,0.4)" strokeWidth={2} />
          <path d="M140 -40 Q180 -10 220 -40 Z" fill="#222" stroke={accent} strokeWidth={2} />
          <text x={180} y={-55} fill={accent} fontSize="11" fontFamily={MONO} textAnchor="middle">VRAM Bandwidth</text>
        </g>
      </svg>
      <div className="px-4 py-1.5 rounded-full bg-black/60 border border-white/20 text-xs font-mono text-white">
        ⚖️ Precision Trade-Off Equilibrium
      </div>
    </div>
  );
};

// 4. Clock Gears Metaphor
export const ClockGearsAnimation: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      <svg width="440" height="440" viewBox="-220 -220 440 440">
        {/* Large Main Gear */}
        <g transform={`rotate(${frame * 1.2} 0 0)`}>
          <circle r={110} fill="none" stroke="#FFFFFF" strokeWidth={6} strokeDasharray="18,10" />
          <circle r={90} fill="#18181B" stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
          <circle r={20} fill={accent} />
          {Array.from({ length: 6 }).map((_, i) => (
            <line
              key={i}
              x1={0}
              y1={0}
              x2={Math.cos((i * Math.PI) / 3) * 90}
              y2={Math.sin((i * Math.PI) / 3) * 90}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={3}
            />
          ))}
        </g>

        {/* Small Interlocking Pinion Gear */}
        <g transform={`translate(130, -75) rotate(${-frame * 2.4} 0 0)`}>
          <circle r={55} fill="none" stroke={accent} strokeWidth={5} strokeDasharray="12,8" />
          <circle r={42} fill="#111" stroke={accent} strokeWidth={1.5} />
          <circle r={10} fill="#FFF" />
        </g>
      </svg>
      <div className="mt-2 px-4 py-1.5 rounded bg-black/60 border border-white/10 text-xs font-mono text-gray-300">
        ⏱️ Escapement Cadence · Single-Pass Prefill
      </div>
    </div>
  );
};

// 5. Procedural Character Sleeping, Reading Script Once & Throwing Out Window Animation
export const CharacterThrowScriptAnimation: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  // Phase 1: Sleeping (0 - 40 frames)
  // Phase 2: Wake up & Scan Script (40 - 85 frames)
  // Phase 3: Throw Script Out Window (85 - 140 frames)
  // Phase 4: Prompt Cached & Discarded (140+ frames)

  const isSleeping = frame < 40;
  const isReading = frame >= 40 && frame < 85;
  const isThrowing = frame >= 85 && frame < 140;
  const isDiscarded = frame >= 140;

  // Paper Position Coordinates
  let paperX = 0;
  let paperY = -120;
  let paperRot = 0;
  let paperOpacity = 1;

  if (isSleeping) {
    paperY = -160 + Math.sin(frame * 0.1) * 5;
    paperOpacity = 0.5;
  } else if (isReading) {
    paperX = 0;
    paperY = -40 + Math.sin(frame * 0.1) * 2;
    paperRot = 0;
    paperOpacity = 1;
  } else if (isThrowing) {
    const throwProgress = (frame - 85) / 55;
    paperX = throwProgress * 320;
    paperY = -40 - Math.sin(throwProgress * Math.PI) * 120 + throwProgress * 40;
    paperRot = throwProgress * 720;
    paperOpacity = Math.max(0, 1 - throwProgress * 0.9);
  } else {
    paperOpacity = 0;
  }

  // Scan Laser
  const scanY = isReading ? -70 + ((frame - 40) % 25) * 4 : -70;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      <svg width="100%" height="100%" viewBox="-250 -130 500 270" className="w-[92%] h-[82%] overflow-visible drop-shadow-2xl">
        {/* ROOM & WINDOW */}
        {/* Window on the Right Wall */}
        <g transform="translate(150, -110)">
          {/* Wall Window Frame */}
          <rect x="-10" y="-10" width="140" height="180" rx="8" fill="#18181B" stroke="#3F3F46" strokeWidth={3} />
          {/* Night Sky / Outside View */}
          <rect x="0" y="0" width="120" height="160" rx="4" fill="#09090B" />
          {/* Outside Moon & Stars */}
          <circle cx="90" cy="35" r="14" fill="#FDE047" opacity={0.9} />
          <circle cx="95" cy="32" r="12" fill="#09090B" />
          {/* Window Panes Grid */}
          <line x1="60" y1="0" x2="60" y2="160" stroke="#27272A" strokeWidth={2} />
          <line x1="0" y1="80" x2="120" y2="80" stroke="#27272A" strokeWidth={2} />
          {/* Window Sill */}
          <rect x="-20" y="160" width="160" height="12" rx="3" fill="#27272A" />
          {/* Open Window Shutter Action */}
          <g transform={`translate(${isThrowing || isDiscarded ? 120 : 60}, 0)`}>
            <rect x="0" y="0" width="55" height="155" fill="none" stroke={accent} strokeWidth={2} opacity={0.6} />
          </g>
        </g>

        {/* DESK SURFACE */}
        <line x1="-300" y1="110" x2="300" y2="110" stroke="#3F3F46" strokeWidth={5} strokeLinecap="round" />
        <rect x="-240" y="112" width="480" height="16" fill="#18181B" rx="4" />

        {/* RETRO COMPUTER / ROBOT CHARACTER */}
        <g transform="translate(-60, 20)">
          {/* Monitor Body */}
          <rect x="-80" y="-80" width="160" height="130" rx="16" fill="#27272A" stroke="#52525B" strokeWidth={4} />
          {/* CRT Screen Bezel */}
          <rect x="-65" y="-68" width="130" height="100" rx="10" fill="#09090B" stroke="#3F3F46" strokeWidth={2} />

          {/* COMPUTER EYES & EMOTIONS */}
          {isSleeping && (
            <g>
              {/* Sleeping Closed Eyes (-.-) */}
              <path d="M -40 -20 Q -25 -10 -10 -20" fill="none" stroke="#71717A" strokeWidth={4} strokeLinecap="round" />
              <path d="M 10 -20 Q 25 -10 40 -20" fill="none" stroke="#71717A" strokeWidth={4} strokeLinecap="round" />
              {/* Floating Zzz */}
              <text x="35" y={-85 - Math.sin(frame * 0.15) * 15} fill="#A1A1AA" fontSize="18" fontFamily={MONO} fontWeight="bold">
                Z
              </text>
              <text x="55" y={-110 - Math.sin(frame * 0.15 + 1) * 15} fill={accent} fontSize="24" fontFamily={MONO} fontWeight="bold">
                Z
              </text>
            </g>
          )}

          {isReading && (
            <g>
              {/* Wide Awake Glowing Eyes (O_O) */}
              <circle cx="-25" cy="-20" r="14" fill={accent} />
              <circle cx="25" cy="-20" r="14" fill={accent} />
              <circle cx="-25" cy="-20" r="6" fill="#FFF" />
              <circle cx="25" cy="-20" r="6" fill="#FFF" />
              {/* Scanning Screen Glare */}
              <line x1="-55" y1="-50" x2="55" y2="-50" stroke={accent} strokeWidth={2} opacity={0.8} />
            </g>
          )}

          {isThrowing && (
            <g>
              {/* Determined Throwing Expression (>_<) */}
              <path d="M -38 -26 L -16 -16 L -38 -6" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" />
              <path d="M 38 -26 L 16 -16 L 38 -6" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" />
              <path d="M -15 10 Q 0 20 15 10" fill="none" stroke="#FFF" strokeWidth={3} strokeLinecap="round" />
            </g>
          )}

          {isDiscarded && (
            <g>
              {/* Smug / Satisfied Wink Screen (^_~) */}
              <path d="M -38 -15 Q -25 -30 -12 -15" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" />
              <circle cx="25" cy="-20" r="10" fill={accent} />
              <circle cx="25" cy="-20" r="4" fill="#FFF" />
              <path d="M -15 8 Q 0 22 15 8" fill="none" stroke="#FFF" strokeWidth={3} strokeLinecap="round" />
            </g>
          )}

          {/* Stand & Base */}
          <rect x="-25" y="50" width="50" height="24" fill="#18181B" stroke="#3F3F46" strokeWidth={2} />
          <rect x="-50" y="74" width="100" height="12" rx="4" fill="#27272A" stroke="#52525B" strokeWidth={2} />

          {/* Computer Robotic Arm */}
          {isThrowing ? (
            <g transform={`rotate(${Math.sin((frame - 85) * 0.15) * 45} 50 10)`}>
              <line x1="50" y1="10" x2="110" y2="-30" stroke={accent} strokeWidth={8} strokeLinecap="round" />
              <circle cx="110" cy="-30" r="8" fill="#FFF" />
            </g>
          ) : (
            <g>
              <line x1="50" y1="20" x2="75" y2="45" stroke="#52525B" strokeWidth={6} strokeLinecap="round" />
              <circle cx="75" cy="45" r="6" fill={accent} />
            </g>
          )}
        </g>

        {/* SCRIPT / PROMPT PAPER DOCUMENT */}
        {paperOpacity > 0 && (
          <g
            transform={`translate(${paperX}, ${paperY}) rotate(${paperRot})`}
            opacity={paperOpacity}
          >
            {/* Paper Sheet */}
            <rect x="-45" y="-60" width="90" height="120" rx="4" fill="#F4F0EA" stroke="#D4D4D8" strokeWidth={2} filter="drop-shadow(0 8px 16px rgba(0,0,0,0.5))" />
            {/* Folded Top Corner */}
            <polygon points="25,-60 45,-40 25,-40" fill="#E4E4E7" />
            {/* Script Heading */}
            <rect x="-35" y="-48" width="50" height="6" rx="2" fill={accent} />
            {/* Script Text Lines */}
            <line x1="-35" y1="-32" x2="30" y2="-32" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />
            <line x1="-35" y1="-20" x2="25" y2="-20" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />
            <line x1="-35" y1="-8" x2="32" y2="-8" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />
            <line x1="-35" y1="4" x2="15" y2="4" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />
            <line x1="-35" y1="16" x2="28" y2="16" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />
            <line x1="-35" y1="28" x2="20" y2="28" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />

            {/* Label Badge */}
            <rect x="-35" y="38" width="70" height="14" rx="3" fill="#09090B" />
            <text x="-30" y="49" fill="#FFF" fontSize="8" fontFamily={MONO} fontWeight="bold">
              PROMPT SCRIPT
            </text>

            {/* Reading Scan Laser Line */}
            {isReading && (
              <g>
                <line x1="-45" y1={scanY} x2="45" y2={scanY} stroke="#EF4444" strokeWidth={3} />
                <rect x="-45" y={scanY - 4} width="90" height="8" fill="#EF4444" opacity={0.25} />
              </g>
            )}
          </g>
        )}

        {/* Speed lines when thrown out window */}
        {isThrowing && (
          <g opacity={0.8}>
            <line x1="80" y1="-20" x2="160" y2="-60" stroke="#FFF" strokeWidth={2} strokeDasharray="8,6" />
            <line x1="90" y1="0" x2="180" y2="-40" stroke={accent} strokeWidth={3} strokeDasharray="12,8" />
            <line x1="120" y1="20" x2="210" y2="-20" stroke="#FFF" strokeWidth={2} strokeDasharray="6,6" />
          </g>
        )}
      </svg>

      {/* Dynamic Status Capsule */}
      <div className="mt-4 px-4 py-2 rounded-full bg-black/80 border border-white/15 text-xs font-mono text-gray-200 flex items-center gap-2 shadow-2xl">
        {isSleeping && <span className="text-yellow-400">💤 1. Computer sleeping in room...</span>}
        {isReading && <span className="text-blue-400">👀 2. Prompt placed in front → Scanned & read ONCE</span>}
        {isThrowing && <span className="text-red-400 font-bold">🪟 3. Tossing script out the window!</span>}
        {isDiscarded && <span className="text-emerald-400 font-bold">✓ 4. Never re-read · Locked in KV Cache</span>}
      </div>
    </div>
  );
};

// Procedural Typing Cursor & Rubber Stamp Quote Animation for GenClaw
export const TypingCursorQuoteAnimation: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const quoteText = "LLMs are a dead end that will never reach real intelligence.";
  const typedCount = Math.min(quoteText.length, Math.floor(frame * 0.8));
  const currentText = quoteText.slice(0, typedCount);
  const showCursor = Math.floor(frame / 12) % 2 === 0;
  const showStamp = frame > 40;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-[#0A0A0B] p-8 rounded-2xl border border-white/10 font-mono overflow-hidden">
      <div className="w-full max-w-2xl bg-[#101013] rounded-xl p-6 border border-white/15 shadow-2xl relative">
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="text-xs text-gray-400 ml-2 font-mono">yann_lecun_quote.txt</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#635BFF]/20 text-[#635BFF] border border-[#635BFF]/40 font-bold">
            PROMPT / STATEMENT
          </span>
        </div>

        <div className="text-lg md:text-xl text-white font-bold leading-relaxed min-h-[80px]">
          "{currentText}"
          {showCursor && <span className="inline-block w-2.5 h-5 ml-1 animate-pulse" style={{ backgroundColor: accent }} />}
        </div>
      </div>

      {showStamp && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-12deg] bg-red-950/90 border-4 border-red-500 text-red-400 font-extrabold text-2xl md:text-3xl px-6 py-3 rounded-lg uppercase tracking-widest shadow-2xl animate-in zoom-in-75 duration-200">
          Yann LeCun Stamp: APPROVED
        </div>
      )}

      <div className="mt-6 px-4 py-1.5 rounded-full bg-black/80 border border-white/15 text-xs text-gray-300 flex items-center gap-2">
        <span className="text-emerald-400 font-bold">⚡ GenClaw Code Engine:</span>
        <span>Visual direction matched: Cursor Quote & Rubber Stamp</span>
      </div>
    </div>
  );
};

// Main Metaphor Viewer Component
export const MetaphorViewer: React.FC<MetaphorProps> = ({ type, frame, accent = "#635BFF" }) => {
  switch (type) {
    case "typing-cursor-quote":
      return <TypingCursorQuoteAnimation frame={frame} accent={accent} />;
    case "character-throw":
      return <CharacterThrowScriptAnimation frame={frame} accent={accent} />;
    case "spider-web":
      return <SpiderWebAnimation frame={frame} accent={accent} />;
    case "liquid-bucket":
      return <LiquidContainerAnimation frame={frame} accent={accent} />;
    case "balance-scale":
      return <BalanceScaleAnimation frame={frame} accent={accent} />;
    case "clock-gears":
      return <ClockGearsAnimation frame={frame} accent={accent} />;
    case "glowing-cluster":
      return (
        <GlowingClusterMetaphor
          width={1920}
          height={1080}
          title="JEPA: PREDICTING MEANING, NOT PIXELS"
          subtitle="Deterministic 3D Abstract Latent Space"
        />
      );
    default:
      return <TypingCursorQuoteAnimation frame={frame} accent={accent} />;
  }
};
