import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const LeafSVG: React.FC<{ color: string; width?: number; style?: React.CSSProperties }> = ({ color, width = 100, style }) => {
  return (
    <svg width={width} viewBox="0 0 100 100" fill={color} style={style}>
      <path d="M50 10 C 90 10, 90 80, 50 95 C 10 80, 10 10, 50 10 Z" />
      <line x1="50" y1="10" x2="50" y2="95" stroke="#ffffff" strokeWidth="3" strokeOpacity="0.4" strokeLinecap="round" />
      <line x1="50" y1="40" x2="70" y2="25" stroke="#ffffff" strokeWidth="3" strokeOpacity="0.4" strokeLinecap="round" />
      <line x1="50" y1="55" x2="30" y2="40" stroke="#ffffff" strokeWidth="3" strokeOpacity="0.4" strokeLinecap="round" />
      <line x1="50" y1="70" x2="70" y2="55" stroke="#ffffff" strokeWidth="3" strokeOpacity="0.4" strokeLinecap="round" />
    </svg>
  );
};

export const FloatingLeaf: React.FC<{ color: string; size: number; startX: number; delay: number; rotationOffset: number }> = ({ color, size, startX, delay, rotationOffset }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  
  // Normalize frame with delay
  const adjustedFrame = Math.max(0, frame - delay);
  
  // Float upwards and wobble
  const y = height - (adjustedFrame * 2); 
  const x = startX + Math.sin(adjustedFrame / 30) * 50;
  const rotation = rotationOffset + Math.sin(adjustedFrame / 20) * 20;
  const opacity = interpolate(adjustedFrame, [0, 30], [0, 0.6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  if (y < -size) return null;

  return (
    <div style={{
      position: "absolute",
      left: 0,
      top: 0,
      translate: `${x}px ${y}px`,
      rotate: `${rotation}deg`,
      opacity: adjustedFrame === 0 ? 0 : opacity,
      zIndex: 0
    }}>
      <LeafSVG color={color} width={size} />
    </div>
  );
};

export const FallingLeaf: React.FC<{ color: string; size: number; startX: number; delay: number; rotationOffset: number }> = ({ color, size, startX, delay, rotationOffset }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  
  const adjustedFrame = Math.max(0, frame - delay);
  
  // Fall downwards
  const y = -size + (adjustedFrame * 2.5); 
  const x = startX + Math.sin(adjustedFrame / 25) * 60;
  const rotation = rotationOffset + adjustedFrame;
  const opacity = interpolate(adjustedFrame, [0, 30], [0, 0.6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  if (y > height + size) return null;

  return (
    <div style={{
      position: "absolute",
      left: 0,
      top: 0,
      translate: `${x}px ${y}px`,
      rotate: `${rotation}deg`,
      opacity: adjustedFrame === 0 ? 0 : opacity,
      zIndex: 0
    }}>
      <LeafSVG color={color} width={size} />
    </div>
  );
};

export const BackgroundLeaves: React.FC<{ type: "green" | "purple" | "mixed" }> = ({ type }) => {
  const leaves = [
    { startX: 200, size: 80, delay: 0, rotationOffset: 10, type: "green" },
    { startX: 1600, size: 120, delay: 20, rotationOffset: -45, type: "purple" },
    { startX: 500, size: 60, delay: 40, rotationOffset: 90, type: "green" },
    { startX: 1300, size: 90, delay: 60, rotationOffset: -20, type: "purple" },
    { startX: 800, size: 100, delay: 80, rotationOffset: 30, type: "green" },
    { startX: 100, size: 70, delay: 100, rotationOffset: 120, type: "purple" },
    { startX: 1800, size: 110, delay: 120, rotationOffset: 15, type: "green" },
  ];

  return (
    <>
      {leaves.map((leaf, i) => {
        let color = "#4ade80"; // green
        if (type === "purple" || (type === "mixed" && leaf.type === "purple")) {
          color = "#c084fc"; // purple
        }
        
        return <FallingLeaf 
          key={i} 
          color={color} 
          size={leaf.size} 
          startX={leaf.startX} 
          delay={leaf.delay} 
          rotationOffset={leaf.rotationOffset} 
        />;
      })}
    </>
  );
};
