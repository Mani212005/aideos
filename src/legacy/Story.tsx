import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, interpolateColors, spring } from "remotion";
import { Scene3D } from "./Leaf3D";

// Premium Design System Tokens
const TOKENS = {
  colors: {
    bgStart: "#0f172a", // Deep slate
    bgEnd: "#020617",
    primaryGreen: "#22c55e",
    primaryPurple: "#a855f7",
    textHigh: "#f8fafc",
    textMedium: "#cbd5e1",
    glass: "rgba(255, 255, 255, 0.05)",
    glassBorder: "rgba(255, 255, 255, 0.1)",
  },
  typography: {
    display: { fontSize: 80, fontWeight: 900, lineHeight: 1.1, letterSpacing: "-0.02em" },
    h1: { fontSize: 56, fontWeight: 800, lineHeight: 1.2 },
    h2: { fontSize: 40, fontWeight: 700, lineHeight: 1.3 },
    h3: { fontSize: 32, fontWeight: 600 },
    body: { fontSize: 24, fontWeight: 400, lineHeight: 1.6 },
    caption: { fontSize: 16, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" as const },
  },
  spacing: {
    xs: 8, sm: 16, md: 24, lg: 32, xl: 48, xxl: 64, xxxl: 96
  }
};

// Premium Text Block with Remotion Springs
const MotionTextBlock: React.FC<{ 
  frame: number; start: number; end: number; 
  x: number; y: number; 
  children: React.ReactNode; 
  align?: "left" | "center" | "right" 
}> = ({ frame, start, end, x, y, children, align = "center" }) => {
  const { fps } = useVideoConfig();
  
  // Custom bezier-like spring for premium feel
  const enterSpring = spring({ frame: frame - start, fps, config: { damping: 14, stiffness: 100, mass: 0.8 } });
  const exitSpring = spring({ frame: frame - (end - 30), fps, config: { damping: 14, stiffness: 100, mass: 0.8 } });
  
  const opacity = frame > end - 30 ? 1 - exitSpring : enterSpring;
  const translateY = interpolate(enterSpring, [0, 1], [40, 0]);
  const exitTranslateY = interpolate(exitSpring, [0, 1], [0, -40]);

  if (frame < start || frame > end) return null;

  return (
    <div style={{
      position: "absolute",
      left: "50%", top: "50%",
      width: 1200,
      transform: `translate(-50%, -50%) translate(${x}px, ${y}px) translateY(${frame > end - 30 ? exitTranslateY : translateY}px)`,
      textAlign: align,
      opacity,
      zIndex: 10,
      fontFamily: "'Inter', 'SF Pro Display', sans-serif",
      color: TOKENS.colors.textHigh
    }}>
      {children}
    </div>
  );
};

const GlassCard: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{
    background: TOKENS.colors.glass,
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: `1px solid ${TOKENS.colors.glassBorder}`,
    borderRadius: 24,
    padding: TOKENS.spacing.xl,
    boxShadow: "0 24px 48px -12px rgba(0,0,0,0.5)",
    ...style
  }}>
    {children}
  </div>
);

export const StoryVideo: React.FC = () => {
  const frame = useCurrentFrame();

  // Dynamic Background morphing
  const bgStart = interpolateColors(
    frame,
    [0, 540, 780, 1200, 1500],
    [TOKENS.colors.bgStart, "#064e3b", "#3b0764", "#2e1065", TOKENS.colors.bgStart]
  );
  const bgEnd = interpolateColors(
    frame,
    [0, 540, 780, 1200, 1500],
    [TOKENS.colors.bgEnd, "#022c22", "#1e1b4b", "#172554", TOKENS.colors.bgEnd]
  );
  
  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${bgStart} 0%, ${bgEnd} 100%)`, overflow: "hidden" }}>
      
      {/* 3D Scene Layer */}
      <Scene3D />

      {/* STORYTELLING UI LAYER */}
      
      {/* Phase 1: Intro (0-240) */}
      <MotionTextBlock frame={frame} start={10} end={240} x={0} y={-250}>
        <h1 style={{ ...TOKENS.typography.display, margin: 0 }}>
          Why Are Most Leaves <span style={{color: TOKENS.colors.primaryGreen}}>Green</span>,<br/>
          While Some Are <span style={{color: TOKENS.colors.primaryPurple}}>Purple</span>?
        </h1>
      </MotionTextBlock>
      
      <MotionTextBlock frame={frame} start={60} end={240} x={0} y={50}>
        <GlassCard>
          <p style={{ ...TOKENS.typography.h3, color: TOKENS.colors.textMedium, margin: 0 }}>
            The vast majority of plants have green leaves.<br/>
            But occasionally you'll come across deep purple or red ones.<br/>
            <span style={{ color: TOKENS.colors.textHigh, fontWeight: 700 }}>Why does this happen?</span>
          </p>
        </GlassCard>
      </MotionTextBlock>

      {/* Phase 2: Why Green (240-540) */}
      <MotionTextBlock frame={frame} start={260} end={530} x={300} y={-100} align="left">
        <h2 style={{ ...TOKENS.typography.display, color: TOKENS.colors.primaryGreen, margin: 0 }}>The Power of Green</h2>
        <p style={{ ...TOKENS.typography.h2, marginTop: TOKENS.spacing.lg }}>
          Leaves contain <strong style={{color: TOKENS.colors.primaryGreen}}>chlorophyll</strong>.
        </p>
        <p style={{ ...TOKENS.typography.h3, color: TOKENS.colors.textMedium, marginTop: TOKENS.spacing.md }}>
          It absorbs blue and red sunlight for photosynthesis, but reflects green light straight into our eyes.
        </p>
      </MotionTextBlock>

      {/* Phase 3: Why Purple (540-780) */}
      <MotionTextBlock frame={frame} start={560} end={770} x={0} y={200}>
        <h2 style={{ ...TOKENS.typography.display, color: TOKENS.colors.primaryPurple, margin: 0 }}>The Purple Mystery</h2>
        <GlassCard style={{ marginTop: TOKENS.spacing.lg }}>
          <p style={{ ...TOKENS.typography.h3, margin: 0 }}>
            Purple leaves are <strong>not</strong> lacking chlorophyll.
          </p>
          <p style={{ ...TOKENS.typography.body, color: TOKENS.colors.textMedium, marginTop: TOKENS.spacing.md, marginBottom: 0 }}>
            The green is simply hidden beneath a vibrant pigment called <strong style={{color: TOKENS.colors.primaryPurple}}>anthocyanin</strong>.
          </p>
        </GlassCard>
      </MotionTextBlock>

      {/* Phase 4: Anthocyanins (780-1080) */}
      <MotionTextBlock frame={frame} start={800} end={1070} x={0} y={200}>
        <h2 style={{ ...TOKENS.typography.h1, color: TOKENS.colors.primaryPurple, margin: 0 }}>What are Anthocyanins?</h2>
        <p style={{ ...TOKENS.typography.h3, color: TOKENS.colors.textMedium, marginTop: TOKENS.spacing.md }}>
          Flavonoids that change color based on the plant's pH.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: TOKENS.spacing.lg, marginTop: TOKENS.spacing.xl }}>
          {["Purple", "Red", "Blue", "Violet"].map((color, i) => (
            <div key={color} style={{
              background: TOKENS.colors.glass,
              border: `1px solid ${TOKENS.colors.glassBorder}`,
              backdropFilter: "blur(12px)",
              padding: `${TOKENS.spacing.md}px ${TOKENS.spacing.xl}px`, 
              borderRadius: 100,
              ...TOKENS.typography.h3,
              color: ["#c084fc", "#f87171", "#60a5fa", "#818cf8"][i],
              transform: `translateY(${Math.sin(frame/15 + i) * 10}px)`
            }}>
              {color}
            </div>
          ))}
        </div>
      </MotionTextBlock>

      {/* Phase 5: Advantages (1080-1440) */}
      <MotionTextBlock frame={frame} start={1100} end={1430} x={250} y={-250} align="left">
        <h2 style={{ ...TOKENS.typography.h1, color: TOKENS.colors.primaryPurple, margin: 0 }}>Evolutionary Edge</h2>
      </MotionTextBlock>

      <MotionTextBlock frame={frame} start={1120} end={1430} x={350} y={50} align="left">
        <div style={{ display: "flex", flexDirection: "column", gap: TOKENS.spacing.md }}>
          {[
            { icon: "🛡️", text: "Protection from intense sunlight" },
            { icon: "❄️", text: "Cold and drought tolerance" },
            { icon: "🐛", text: "Defence against herbivores" }
          ].map((item, index) => {
            const delay = 1140 + index * 30;
            const itemSpring = spring({ frame: frame - delay, fps: 30, config: { damping: 12 } });
            
            return (
              <div key={index} style={{
                opacity: interpolate(itemSpring, [0, 1], [0, 1]),
                transform: `translateX(${interpolate(itemSpring, [0, 1], [50, 0])}px)`,
                ...TOKENS.typography.h3,
                color: TOKENS.colors.textHigh,
                display: "flex", alignItems: "center", gap: TOKENS.spacing.md,
                background: TOKENS.colors.glass,
                border: `1px solid ${TOKENS.colors.glassBorder}`,
                padding: `${TOKENS.spacing.sm}px ${TOKENS.spacing.xl}px`,
                borderRadius: 16
              }}>
                <span style={{ fontSize: 32 }}>{item.icon}</span>
                {item.text}
              </div>
            );
          })}
        </div>
      </MotionTextBlock>

      {/* Phase 6: Conclusion (1440-1590) */}
      <MotionTextBlock frame={frame} start={1460} end={1590} x={0} y={-250}>
        <h2 style={{ ...TOKENS.typography.display, margin: 0 }}>
          Nature's Balance
        </h2>
        <GlassCard style={{ marginTop: TOKENS.spacing.lg }}>
          <p style={{ ...TOKENS.typography.h3, color: TOKENS.colors.textMedium, margin: 0 }}>
            Green is the most efficient strategy for capturing light.<br/>
            Purple pigments cost energy, so they are only produced<br/>
            when their <strong style={{color: TOKENS.colors.textHigh}}>protective benefits</strong> outweigh the cost.
          </p>
        </GlassCard>
      </MotionTextBlock>

    </AbsoluteFill>
  );
};
