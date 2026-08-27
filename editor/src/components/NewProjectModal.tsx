/**
 * File Description: Script Intake & New Project Creation Studio Modal dialog for pasting raw scripts, selecting character archetypes & themes, and automatically compiling production video projects.
 */

import { useState } from "react";
import type { Film } from "../../../src/dl/schema";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (film: Film, script: string) => void;
}

const ARCHETYPES = [
  { id: "astronaut", name: "Astronaut Guide", icon: "🚀", domain: "Space, Physics & Exploration" },
  { id: "developer", name: "Lead Engineer", icon: "💻", domain: "Software, Cloud & Infrastructure" },
  { id: "dataEngineer", name: "Data Architect", icon: "📊", domain: "Data, Databases & Pipelines" },
  { id: "scientist", name: "Research Scientist", icon: "🔬", domain: "AI, Math & Hardware Architecture" },
  { id: "executive", name: "Tech Executive", icon: "👔", domain: "Leadership, Strategy & Vision" },
  { id: "robot", name: "Cyber Robot", icon: "🤖", domain: "Robotics, Algorithms & State Machines" },
  { id: "educator", name: "Academic Tutor", icon: "🎓", domain: "Concepts, Tutorials & Walkthroughs" },
  { id: "mascot", name: "Creative Mascot", icon: "🦊", domain: "Branding, Product & Culture" },
];

const THEMES = [
  { id: "smooth-dark", name: "Smooth Dark", accent: "#FF6B00", bgPreview: "bg-[#0A0B10]" },
  { id: "paper-white", name: "Paper White", accent: "#635BFF", bgPreview: "bg-[#F8F9FA]" },
  { id: "blueprint-grid", name: "Blueprint", accent: "#00E5FF", bgPreview: "bg-[#0A192F]" },
  { id: "subtle-dots", name: "Terminal Dots", accent: "#10B981", bgPreview: "bg-[#111827]" },
];

const VOICES = [
  { id: "kokoro-am_adam", name: "⚡ Kokoro: Adam (Crisp Technical - Male)" },
  { id: "kokoro-af_bella", name: "⚡ Kokoro: Bella (Warm Explainer - Female)" },
  { id: "kokoro-af_nicole", name: "⚡ Kokoro: Nicole (Dynamic Tech - Female)" },
  { id: "kokoro-am_michael", name: "⚡ Kokoro: Michael (Deep Narrative - Male)" },
  { id: "aura-helios-en", name: "⚡ Deepgram: Helios (Tech Lead - Male)" },
  { id: "aura-asteria-en", name: "⚡ Deepgram: Asteria (Clear Narrative - Female)" },
];

/**
 * Modal dialog for pasting raw scripts and compiling full video projects.
 */
export function NewProjectModal({ isOpen, onClose, onProjectCreated }: NewProjectModalProps) {
  const [tab, setTab] = useState<"intake" | "blank">("intake");
  const [title, setTitle] = useState<string>("");
  const [slug, setSlug] = useState<string>("");
  const [script, setScript] = useState<string>("");
  const [characterId, setCharacterId] = useState<string>("developer");
  const [themeId, setThemeId] = useState<string>("smooth-dark");
  const [voiceId, setVoiceId] = useState<string>("kokoro-am_adam");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.round((wordCount / 145) * 60);
  const estimatedMinutes = Math.floor(estimatedSeconds / 60);
  const estimatedRemainingSecs = estimatedSeconds % 60;
  const estimatedTimeFormatted = `${estimatedMinutes}:${estimatedRemainingSecs.toString().padStart(2, "0")}`;

  /**
   * Generates a URL-friendly lowercase slug from a project title.
   */
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    const autoSlug = newTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setSlug(autoSlug);
    setError(null);
  };

  /**
   * Submits new project creation and auto-compilation request to /api/projects/new.
   */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please enter a video project title.");
      return;
    }
    const finalSlug = (slug || title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!finalSlug) {
      setError("Please enter a valid project identifier.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const selectedTheme = THEMES.find((t) => t.id === themeId) || THEMES[0];

    try {
      const res = await fetch("/api/projects/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          id: finalSlug,
          script: script.trim(),
          characterId,
          theme: themeId,
          accent: selectedTheme.accent,
          voice: voiceId,
          autoCompile: tab === "intake" && Boolean(script.trim()),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create and compile project.");

      onProjectCreated(data.film, data.script);
      onClose();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 font-sans">
      <div className="bg-[#0F1015] border border-[#262733] w-full max-w-2xl rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-[#F5F5F5] max-h-[90vh] overflow-y-auto">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#20222D] pb-3.5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎬</span>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Script Intake & Film Compiler</h3>
              <p className="text-xs text-[#8A8A8E]">Paste your script or outline to compile a full animated explainer video</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#20222D] transition-all"
          >
            ×
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center bg-[#15161E] p-1 rounded-xl border border-[#262733]">
          <button
            type="button"
            onClick={() => setTab("intake")}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              tab === "intake"
                ? "bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/30"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <span>🤖</span>
            <span>Paste Script & AI Compile</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("blank")}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              tab === "blank"
                ? "bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/30"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <span>📄</span>
            <span>Blank Project Outline</span>
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          
          {/* Project Title Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-300 font-bold uppercase tracking-wider flex items-center justify-between">
              <span>Video Title <span className="text-red-400">*</span></span>
              {slug && <span className="text-[11px] font-mono text-[#8A8A8E]">slug: {slug}</span>}
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Why Liquid Water Cannot Exist on Mars"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="bg-[#15161E] border border-[#2B2D3C] rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-[#635BFF] placeholder:text-gray-600 font-medium transition-all"
              autoFocus
            />
          </div>

          {/* Script Paste Input */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-300 font-bold uppercase tracking-wider">
                {tab === "intake" ? "Voiceover Script / Narration" : "Initial Notes"}
              </label>
              {tab === "intake" && wordCount > 0 && (
                <span className="text-[11px] text-emerald-400 font-mono">
                  {wordCount} words · ~{estimatedTimeFormatted} runtime
                </span>
              )}
            </div>
            <textarea
              rows={tab === "intake" ? 6 : 3}
              placeholder={
                tab === "intake"
                  ? "Paste your narration script, screenplay or talking points here...\n\nExample:\nMars was once a warm wet world with deep oceans, but today pure liquid water cannot exist on its surface.\n\nThe primary culprit is the Martian atmosphere, which is less than 1% as dense as Earth's.\n\nBecause atmospheric pressure sits below the thermodynamic triple point of water, ice sublimates directly into vapor."
                  : "Write initial ideas or bullet points for your new project."
              }
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="bg-[#15161E] border border-[#2B2D3C] rounded-xl p-3.5 text-xs text-white outline-none focus:border-[#635BFF] placeholder:text-gray-600 resize-none font-mono leading-relaxed transition-all"
            />
          </div>

          {/* Customization Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Character Archetype */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-300 font-bold uppercase tracking-wider">
                Presenter Archetype
              </label>
              <select
                value={characterId}
                onChange={(e) => setCharacterId(e.target.value)}
                className="bg-[#15161E] border border-[#2B2D3C] rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-[#635BFF] font-medium"
              >
                {ARCHETYPES.map((arch) => (
                  <option key={arch.id} value={arch.id}>
                    {arch.icon} {arch.name} ({arch.domain})
                  </option>
                ))}
              </select>
            </div>

            {/* Neural Voice */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-300 font-bold uppercase tracking-wider">
                Voiceover Voice
              </label>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                className="bg-[#15161E] border border-[#2B2D3C] rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-[#635BFF] font-medium"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Visual Theme */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-300 font-bold uppercase tracking-wider">
                Visual Theme
              </label>
              <select
                value={themeId}
                onChange={(e) => setThemeId(e.target.value)}
                className="bg-[#15161E] border border-[#2B2D3C] rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-[#635BFF] font-medium"
              >
                {THEMES.map((th) => (
                  <option key={th.id} value={th.id}>
                    {th.name} ({th.accent})
                  </option>
                ))}
              </select>
            </div>

            {/* Identifier Preview */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-300 font-bold uppercase tracking-wider">
                Project File Slug
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="project-slug"
                className="bg-[#15161E] border border-[#2B2D3C] rounded-xl px-3.5 py-2 text-xs text-white font-mono outline-none focus:border-[#635BFF]"
              />
            </div>
          </div>

          {/* Modal Footer Controls */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#20222D]">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-4 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-[#1A1A22] font-semibold transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="text-xs px-5 py-2.5 rounded-xl bg-[#635BFF] hover:bg-[#5249e6] active:scale-95 text-white font-bold transition-all shadow-lg shadow-[#635BFF]/30 disabled:opacity-50 flex items-center gap-2"
            >
              <span>{isSubmitting ? "⏳" : tab === "intake" ? "✨" : "➕"}</span>
              <span>
                {isSubmitting
                  ? "Compiling Film & Audio..."
                  : tab === "intake"
                  ? "Compile Film from Script"
                  : "Create Project"}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
