/**
 * File Description: New Project Creation Modal dialog for creating fresh video projects and initializing script files.
 */

import { useState } from "react";
import type { Film } from "../../../src/dl/schema";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (film: Film, script: string) => void;
}

/**
 * Modal dialog for spinning up a new video project and creating initial script files.
 */
export function NewProjectModal({ isOpen, onClose, onProjectCreated }: NewProjectModalProps) {
  const [title, setTitle] = useState<string>("");
  const [slug, setSlug] = useState<string>("");
  const [script, setScript] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

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
   * Submits new project creation request to /api/projects/new.
   */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please enter a project title.");
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

    try {
      const res = await fetch("/api/projects/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          id: finalSlug,
          script: script.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create new project.");

      onProjectCreated(data.film, data.script);
      onClose();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-sans">
      <div className="bg-[#121216] border border-[#2A2A35] w-full max-w-lg rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-[#F5F5F5]">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#222] pb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🎬</span>
            <h3 className="text-lg font-bold text-white tracking-tight">Create New Video Project</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#222]"
          >
            ×
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-950/40 border border-red-800 rounded-lg text-xs text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          
          {/* Project Title Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">
              Video Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Why Transformers Scale - Attention Explained"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="bg-[#1A1A22] border border-[#333] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:border-[#635BFF] placeholder:text-gray-600 font-medium"
              autoFocus
            />
          </div>

          {/* Project ID / Slug Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">
              Project Identifier (File Slug)
            </label>
            <div className="flex items-center bg-[#1A1A22] border border-[#333] rounded-lg px-3 py-2 text-xs text-gray-400 font-mono">
              <span className="text-gray-600">scripts/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="project-slug"
                className="bg-transparent flex-1 text-white outline-none font-mono text-xs"
              />
              <span className="text-gray-600">.md</span>
            </div>
            <span className="text-[11px] text-[#8A8A8E]">
              Creates <code className="text-gray-400">scripts/{slug || "project"}.md</code> and <code className="text-gray-400">src/dl/films/{slug || "project"}.ts</code>
            </span>
          </div>

          {/* Starting Script Idea / Outline */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">
              Initial Script / Core Idea <span className="text-gray-600 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={3}
              placeholder="Paste your opening hook or initial talking points. You can flesh this out fully in the Script Studio."
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="bg-[#1A1A22] border border-[#333] rounded-lg p-3 text-xs text-white outline-none focus:border-[#635BFF] placeholder:text-gray-600 resize-none font-mono"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#222]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-bold text-gray-400 hover:text-white bg-[#1A1A22] hover:bg-[#252530] border border-[#333]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="px-5 py-2 rounded-lg text-xs font-bold text-white bg-[#635BFF] hover:bg-[#5249e6] shadow-lg shadow-[#635BFF]/30 transition-all disabled:opacity-50 active:scale-95"
            >
              {isSubmitting ? "Creating Project..." : "Create Project & Open Script"}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
