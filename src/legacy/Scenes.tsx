import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { BackgroundLeaves } from "./LeafDesign";

const TEXT_COLOR = "#1f2937";
const GREEN = "#16a34a";
const PURPLE = "#9333ea";
const BG_GRADIENT_DEFAULT = "linear-gradient(135deg, #f0fdf4 0%, #fdf4ff 100%)";
const BG_GRADIENT_GREEN = "linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%)";
const BG_GRADIENT_PURPLE = "linear-gradient(135deg, #f3e8ff 0%, #fdf4ff 100%)";

const SceneContainer: React.FC<{ children: React.ReactNode; bgGradient?: string; leafType?: "green" | "purple" | "mixed" }> = ({ children, bgGradient = BG_GRADIENT_DEFAULT, leafType = "mixed" }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOutOpacity = interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ 
      background: bgGradient, 
      justifyContent: "center", 
      alignItems: "center",
      opacity: frame > durationInFrames - 15 ? fadeOutOpacity : opacity,
      overflow: "hidden"
    }}>
      <BackgroundLeaves type={leafType} />
      <div style={{
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255, 255, 255, 0.6)",
        backdropFilter: "blur(16px)",
        padding: "80px 100px",
        borderRadius: "40px",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255,255,255,0.5) inset",
        maxWidth: 1500,
        textAlign: "center"
      }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

export const Intro = () => {
  const frame = useCurrentFrame();
  return (
    <SceneContainer leafType="mixed">
      <h1 style={{ 
        fontFamily: "system-ui, sans-serif", 
        fontSize: 90, 
        color: TEXT_COLOR,
        margin: 0,
        fontWeight: 800,
        lineHeight: 1.2,
        translate: `0px ${interpolate(frame, [0, 30], [50, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) })}px`,
      }}>
        Why Are Most Leaves <span style={{color: GREEN}}>Green</span>,<br/>While Some Are <span style={{color: PURPLE}}>Purple</span>?
      </h1>
      <p style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 45,
        color: "#4b5563",
        marginTop: 60,
        fontWeight: 500,
        opacity: interpolate(frame, [45, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        translate: `0px ${interpolate(frame, [45, 60], [20, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) })}px`,
      }}>
        When you look around, the vast majority of plants have green leaves.<br/>But occasionally you'll come across plants with deep purple, red, or almost black leaves.<br/>Why does this happen?
      </p>
    </SceneContainer>
  );
};

export const WhyGreen = () => {
  const frame = useCurrentFrame();
  return (
    <SceneContainer bgGradient={BG_GRADIENT_GREEN} leafType="green">
      <h2 style={{ 
        fontFamily: "system-ui, sans-serif", 
        fontSize: 80, 
        color: GREEN,
        fontWeight: 800,
        margin: "0 0 40px 0",
        scale: interpolate(frame, [0, 15], [0.8, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) })
      }}>
        Why are most leaves green?
      </h2>
      <div style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 45,
        color: TEXT_COLOR,
        lineHeight: 1.6,
        fontWeight: 500,
        opacity: interpolate(frame, [30, 45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      }}>
        <p>Leaves are green because they contain a pigment called <strong style={{color: GREEN}}>chlorophyll</strong>.</p>
        <p>Chlorophyll's job is to absorb sunlight and convert it into chemical energy through <strong>photosynthesis</strong>.</p>
        <p>It absorbs mainly blue and red wavelengths of light but <strong>reflects green light</strong>, which is why our eyes see leaves as green.</p>
      </div>
    </SceneContainer>
  );
};

export const WhyPurple = () => {
  const frame = useCurrentFrame();
  return (
    <SceneContainer bgGradient={BG_GRADIENT_PURPLE} leafType="purple">
      <h2 style={{ 
        fontFamily: "system-ui, sans-serif", 
        fontSize: 80, 
        color: PURPLE,
        fontWeight: 800,
        margin: "0 0 40px 0",
        scale: interpolate(frame, [0, 15], [0.8, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) })
      }}>
        Why are some leaves purple?
      </h2>
      <div style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 45,
        color: TEXT_COLOR,
        lineHeight: 1.6,
        fontWeight: 500,
        opacity: interpolate(frame, [30, 45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      }}>
        <p>Purple leaves are <strong>not</strong> purple because they lack chlorophyll.</p>
        <p>In fact, purple leaves usually still contain plenty of chlorophyll.<br/>The green colour is simply hidden beneath another pigment called <strong style={{color: PURPLE}}>anthocyanin</strong>.</p>
      </div>
    </SceneContainer>
  );
};

export const WhatAreAnthocyanins = () => {
  const frame = useCurrentFrame();
  return (
    <SceneContainer bgGradient={BG_GRADIENT_PURPLE} leafType="purple">
      <h2 style={{ 
        fontFamily: "system-ui, sans-serif", 
        fontSize: 80, 
        color: PURPLE,
        fontWeight: 800,
        margin: "0 0 40px 0",
        scale: interpolate(frame, [0, 15], [0.8, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) })
      }}>
        What are anthocyanins?
      </h2>
      <div style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 45,
        color: TEXT_COLOR,
        lineHeight: 1.6,
        fontWeight: 500,
        opacity: interpolate(frame, [30, 45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      }}>
        <p>Anthocyanins belong to a family of compounds known as <strong>flavonoids</strong>.</p>
        <p>These pigments can appear <strong style={{color: "#a855f7"}}>Purple</strong>, <strong style={{color: "#ef4444"}}>Red</strong>, <strong style={{color: "#3b82f6"}}>Blue</strong>, or <strong style={{color: "#4c1d95"}}>Dark violet</strong><br/>depending on the acidity (pH) inside the plant's cells.</p>
        <p>They are made primarily from Carbon, Hydrogen, and Oxygen.</p>
      </div>
    </SceneContainer>
  );
};

export const Advantages = () => {
  const frame = useCurrentFrame();
  return (
    <SceneContainer bgGradient={BG_GRADIENT_PURPLE} leafType="purple">
      <h2 style={{ 
        fontFamily: "system-ui, sans-serif", 
        fontSize: 70, 
        color: PURPLE,
        fontWeight: 800,
        margin: "0 0 40px 0",
      }}>
        Why would a plant make purple pigments?
      </h2>
      <ul style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 40,
        color: TEXT_COLOR,
        lineHeight: 1.8,
        fontWeight: 500,
        listStyleType: "none",
        padding: 0,
        margin: 0,
        textAlign: "left"
      }}>
        {[
          "🛡️ Protection from intense sunlight",
          "☀️ Protection against UV radiation (natural sunscreen)",
          "🧬 Antioxidant defence against harmful molecules",
          "❄️ Cold and drought tolerance",
          "🐛 Defence against herbivores (insects or grazing animals)"
        ].map((item, index) => {
          const delay = 30 + index * 15;
          return (
            <li key={index} style={{
              opacity: interpolate(frame, [delay, delay + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              translate: `0px ${interpolate(frame, [delay, delay + 15], [20, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) })}px`,
              background: "rgba(255,255,255,0.5)",
              padding: "10px 30px",
              margin: "15px 0",
              borderRadius: "20px"
            }}>
              {item}
            </li>
          );
        })}
      </ul>
    </SceneContainer>
  );
};

export const DoPurplePhotosynthesise = () => {
  const frame = useCurrentFrame();
  return (
    <SceneContainer leafType="mixed">
      <h2 style={{ 
        fontFamily: "system-ui, sans-serif", 
        fontSize: 80, 
        color: TEXT_COLOR,
        fontWeight: 800,
        margin: "0 0 40px 0",
        scale: interpolate(frame, [0, 15], [0.8, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) })
      }}>
        Do purple leaves photosynthesise?
      </h2>
      <div style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 90,
        color: GREEN,
        fontWeight: 900,
        margin: "0 0 40px 0",
        opacity: interpolate(frame, [30, 45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        scale: interpolate(frame, [30, 45], [0.5, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) })
      }}>
        Yes.
      </div>
      <div style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 45,
        color: TEXT_COLOR,
        lineHeight: 1.6,
        fontWeight: 500,
        opacity: interpolate(frame, [60, 75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      }}>
        <p>Purple plants still perform photosynthesis because they still contain <strong style={{color: GREEN}}>chlorophyll</strong>.</p>
        <p>The <strong style={{color: PURPLE}}>anthocyanin</strong> pigments simply mask the green colour.</p>
      </div>
    </SceneContainer>
  );
};

export const Conclusion = () => {
  const frame = useCurrentFrame();
  return (
    <SceneContainer leafType="mixed">
      <h2 style={{ 
        fontFamily: "system-ui, sans-serif", 
        fontSize: 80, 
        color: GREEN,
        fontWeight: 800,
        margin: "0 0 40px 0",
        scale: interpolate(frame, [0, 15], [0.8, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) })
      }}>
        Why don't all plants become purple?
      </h2>
      <div style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 45,
        color: TEXT_COLOR,
        lineHeight: 1.6,
        fontWeight: 500,
        opacity: interpolate(frame, [30, 45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      }}>
        <p>Producing anthocyanins requires energy and resources.</p>
        <p>For many plants, having lots of chlorophyll and maximising light capture<br/>is the better strategy.</p>
        <p>Purple pigments are generally produced only when their<br/><strong>protective benefits outweigh the energy cost</strong>.</p>
      </div>
    </SceneContainer>
  );
};
