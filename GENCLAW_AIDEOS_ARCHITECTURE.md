# Aideos Code-Driven Agentic Video Architecture Blueprint (v2.0)
> Inspired by GenClaw (arXiv:2605.30248) · Enhanced with Deterministic Spatial Assertions & Locked Design System Constraints

---

## 🗺️ Refined System Architecture Mind Map

```mermaid
mindmap
  root((Aideos Code-Driven Video Engine))
    Perception & Script Intelligence
      Script Deconstruction
        Extract narrative intent & tone
        Generate shot timing map (Kokoro 82M TTS)
      Design System Injection (AGENTS.md)
        Strict 6-value HSL/HEX color palette
        Geist & JetBrains Mono typography
        7 Animated Primitives & single canvas
    Code Canvas Drafting Tools
      code_scene_draft
        SVG layout vectors & Canvas 2D
        Three.js 3D WebGL scenes
      code_kinetic_text
        Word-level spring animation
        Sub-second Kokoro timestamp alignment
      remotion_assembler
        React TSX Composition generator
        Multi-track audio/video timeline
    4-Tier Verification Gate
      Tier 1: TS Compiler Check
        Instant syntax & prop type validation
      Tier 2: Deterministic Spatial Assertions
        Continuous frame-by-frame math check
        Bounding box overlap & collision detection
        Viewport & safe-zone bounds check
      Tier 3: Multi-Frame VLM Review
        3-4 milestone frame visual inspection
        Aesthetic balance & composition check
      Tier 4: Bounded Auto-Repair
        Local edit first (edit_previous)
        Escalate to full rewrite after 2 local failures
        Hard cap at 3 max repair rounds
    Deterministic 60fps Rendering
      Chromium Headless Render
        Zero diffusion artifacts
        100% vector sharp
        Frame-accurate audio sync
      Output Artifacts
        4K / 1080p MP4
        Transparent WebM
```

---

## 🔄 Refined Execution & Verification Flowchart

```mermaid
flowchart TD
    UserScript["User Script / Topic Request"] --> Perception["1. Perception & Design System Injector"]
    Perception --> StoryGraph["Story Graph & Kokoro TTS Timestamp Map"]
    
    subgraph ToolChain["2. Code Drafting Tool Chain"]
        StoryGraph --> SceneDraft["code_scene_draft<br/>(SVG / Canvas / Three.js)"]
        StoryGraph --> TextDraft["code_kinetic_text<br/>(Kokoro TTS Sync)"]
        SceneDraft --> RemotionAssembler["remotion_assembler<br/>(React TSX Composition)"]
        TextDraft --> RemotionAssembler
    end

    subgraph Verification["3. 4-Tier Verification Gate Engine"]
        RemotionAssembler --> T1_TS{"Tier 1: TS Compiler Check"}
        T1_TS -- "Syntax Error" --> RepairMachine
        
        T1_TS -- "Pass" --> T2_Spatial{"Tier 2: Spatial Math Assertions<br/>(Every 5th frame bounding box check)"}
        T2_Spatial -- "Overlap / Out of Bounds" --> RepairMachine
        
        T2_Spatial -- "Pass" --> T3_VLM{"Tier 3: Multi-Frame VLM Review<br/>(Visual balance at t0, t_mid, t_end)"}
        T3_VLM -- "Unbalanced / Glitch" --> RepairMachine
        
        RepairMachine["Tier 4: Bounded Repair State Machine<br/>• Rounds <= 3<br/>• Round 1-2: Local edit_previous<br/>• Round 3: Escalate to regenerate_from_source"]
        RepairMachine -- "Attempts < 3" --> RemotionAssembler
        RepairMachine -- "Attempts >= 3 (Oscillation detected)" --> FallbackNotify["Report Diagnostic to Captain"]
    end

    T3_VLM -- "Approved" --> RenderEngine["4. Remotion 60fps Renderer"]
    RenderEngine --> FinalMP4["Final 4K MP4 / WebM Video"]

    style Perception fill:#2b3a4a,stroke:#4a90e2,color:#ffffff
    style ToolChain fill:#1e293b,stroke:#38bdf8,color:#ffffff
    style Verification fill:#331e3b,stroke:#c084fc,color:#ffffff
    style RenderEngine fill:#14532d,stroke:#22c55e,color:#ffffff
```

---

## 🔬 Critical Analysis of Feedback: Accepted vs. Refined

| Feedback Item | Evaluation | Architectural Decision |
| :--- | :--- | :--- |
| **1. Deterministic Spatial Assertions** | **ACCEPTED (100%)** | Inserted Tier 2 math assertions (bounding box overlap, safe zone, off-screen checks) before calling VLM. Saves money, instant execution. |
| **2. Continuous Timeline Sampling** | **ACCEPTED & DUAL-TIERED** | Spatial assertions run frame-by-frame across the full timeline ($t_0 \dots t_N$). VLM vision inspection is reserved for 3-4 key milestone frames. |
| **3. Enforced Visual Identity** | **ACCEPTED & EXPLICIT** | Injected Aideos `AGENTS.md` design system rules (6-value palette, Geist/JetBrains typography, cubic-bezier easing) directly into the Perception phase. |
| **4. Bounded Repair State Machine** | **ACCEPTED & REFINED** | Hard cap at 3 repair rounds. Rounds 1-2 enforce local `edit_previous`; Round 3 escalates to `regenerate_from_source`. Prevents thrashing. |

---

## 🛠️ Updated Implementation Plan in `projects/aideos`

1. **Perception Module (`src/agent/perception.ts`)**:
   - Parses script and injects strict design system constraints (`#0A0A0B` background, `#F5F5F5` primary text, `#635BFF` accent, Geist/JetBrains fonts).

2. **Spatial Assertion Validator (`src/agent/spatial_assert.ts`)**:
   - Computes element bounding boxes across keyframes ($x, y, w, h$) to detect text overlaps, canvas overflow, or clipping deterministically without vision model calls.

3. **Multi-Frame VLM Evaluator (`src/agent/vlm_eval.ts`)**:
   - Takes 3-4 keyframe snapshots ($t_0$, $t_{\text{mid}}$, $t_{\text{final}}$) for aesthetic composition review once spatial assertions pass.

4. **Bounded State Machine (`src/agent/repair_machine.ts`)**:
   - Tracks repair attempts, prevents infinite thrashes, and escalates intelligently from local edits to full regeneration.
