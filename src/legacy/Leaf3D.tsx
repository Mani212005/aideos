import React from "react";
import { useCurrentFrame, interpolate, interpolateColors, Easing } from "remotion";

export const Scene3D: React.FC = () => {
  const frame = useCurrentFrame();

  const leafColor = interpolateColors(
    frame,
    [580, 680],
    ["#22c55e", "#a855f7"]
  );

  const scale = interpolate(
    frame,
    [0, 200, 240, 300, 500, 540, 700, 760, 1040, 1080, 1400, 1440],
    [1, 1, 1.8, 1.8, 1.8, 1.3, 1.3, 1.1, 1.1, 0.8, 0.8, 0.9],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }
  );

  const x = interpolate(
    frame,
    [0, 200, 240, 300, 500, 540, 700, 760, 1040, 1080, 1400, 1440],
    [0, 0, -400, -400, -400, 0, 0, 0, 0, -450, -450, -250],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }
  );

  const y = interpolate(
    frame,
    [0, 200, 240, 300, 500, 540, 700, 760, 1040, 1080, 1400, 1440],
    [0, 0, 0, 0, 0, -150, -150, -250, -250, 0, 0, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }
  );

  const rotation = interpolate(
    frame,
    [0, 1590],
    [-15, 25]
  );

  // Organic floating
  const floatingY = Math.sin(frame / 30) * 15;
  const floatingX = Math.cos(frame / 40) * 10;

  return (
    <div style={{ position: "absolute", width: "100%", height: "100%", zIndex: 1, pointerEvents: "none" }}>
      {/* Glow behind the leaf */}
      <div style={{
        position: "absolute",
        width: 800, height: 800,
        borderRadius: "50%",
        background: leafColor,
        filter: "blur(200px)",
        opacity: 0.1,
        left: "50%", top: "50%",
        transform: `translate(-50%, -50%) translate(${x * 0.5}px, ${y * 0.5}px)`
      }}/>
      
      <div style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: `translate(-50%, -50%) translate(${x + floatingX}px, ${y + floatingY}px) scale(${scale}) rotate(${rotation}deg)`,
        filter: "drop-shadow(0 30px 40px rgba(0,0,0,0.3))",
      }}>
        <svg width="600" height="600" viewBox="0 0 100 100" fill={leafColor} style={{ overflow: "visible" }}>
          {/* Main Leaf Body with organic curve */}
          <path d="M50 5 C 100 20, 110 70, 50 95 C -10 70, 0 20, 50 5 Z" />
          
          {/* Premium Veins */}
          <path d="M50 5 Q 55 50 50 95" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M51 25 Q 65 20 75 15" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinecap="round" />
          <path d="M51 45 Q 75 35 85 30" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinecap="round" />
          <path d="M51 65 Q 80 60 85 55" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinecap="round" />
          
          <path d="M49 30 Q 30 22 20 18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinecap="round" />
          <path d="M49 50 Q 25 40 12 35" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinecap="round" />
          <path d="M49 70 Q 20 65 15 60" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
};
