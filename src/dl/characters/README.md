# Vector Character Rig System & Authoring Specification

## Overview

Aideos renders animated character guides as pure TypeScript vector modules in `src/dl/characters/`. Rigs execute synchronously inside Remotion at pure 60 FPS with zero runtime image decoding, infinite vector scalability, and 100% theme color palette reactivity.

---

## 1. 2-Level Hierarchical Kinematic Tree

Every character rig is composed of 5 standard joint groups:

```
                  [ legs ] (Root base / hover thruster)
                     │
                  [ torso ] (Root parent: pivot at hip/spine)
                     ├── [ head ] (Parent: torso, pivot at neck)
                     ├── [ leftArm ] (Parent: torso, pivot at left shoulder)
                     └── [ rightArm ] (Parent: torso, pivot at right shoulder)
```

### Hierarchy Rules:
* Rotating `torso` automatically rotates and translates the `head`, `leftArm`, and `rightArm` seamlessly in nested SVG `<g>` groups.
* The `pivot: { x, y }` defines the exact rotational hinge coordinate in virtual viewBox pixels (standard `viewBox: "0 0 400 600"`).

---

## 2. Semantic Color Token Bindings (Axiom 4 Compliance)

To ensure character rigs dynamically adopt any theme (Archival White, Blueprint, Charcoal, Warm Editorial, etc.) without manual recoloring, vector paths must bind **semantic token slots** rather than hardcoded hex colors:

* **`surface`**: Main body clothing, armor plate, or suit fabric (e.g. `#FFFFFF` on paper, `#101013` on dark).
* **`ink`**: High-contrast outlines, hair, eyes, and soles (e.g. `#111827` on paper, `#F5F5F5` on dark).
* **`muted`**: Hands, skin tones, or secondary vest panels (e.g. `#8A8A8E`).
* **`hairline`**: Subtle pocket borders, stitches, and seams (e.g. `rgba(245,245,245,0.10)`).
* **`accent`**: The focal brand color (visor glow, tie, badge, smartwatch, LED eyes). Automatically recolors to `film.theme.accent` (e.g. `#635BFF`, `#FF6B00`, `#10B981`).
* **`canvas`**: Inner screen glass or shadowed recesses (e.g. `#0A0A0B`).

---

## 3. Available Built-In Character Cast

1. **`astronaut`** (*Astro Guide*): Deep-tech space explorer with reflective accent visor and life-support pack.
2. **`developer`** (*Tech Architect*): Modern dev lead with hoodie, conference lanyard badge, and glasses.
3. **`robot`** (*Cyber AI Bot*): Floating friendly AI companion with glowing LED visor and articulated claw arms.
4. **`scientist`** (*AI Researcher*): White lab coat, round smart glasses, and research credentials badge.
5. **`executive`** (*Tech Founder*): Tailored blazer, collar shirt, smartwatch, and keynote presenter posture.
6. **`data-engineer`** (*Systems Architect*): Over-ear headphones, terminal prompt hoodie, and DevOps posture.
7. **`educator`** (*Academic Tutor*): Cozy cardigan vest, spectacles, and step-by-step teaching gestures.
8. **`mascot`** (*Geometric Bot*): Minimalist rounded companion with expressive digital eye visor.

---

## 4. How to Register a New Character

1. Create a new rig module in `src/dl/characters/<name>.ts` exporting `CharacterRig`.
2. Register in `src/dl/characters/index.ts` in `CHARACTER_RIGS`.
3. Run `npm test` to verify that the new character passes `characterRigSchema` and the automated Theme-Token Conformance gate.
