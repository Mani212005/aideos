/**
 * File Description: New project dialog for Aideos Studio.
 * Two honest ways to start: paste a script and let Aideos compile a first cut from it, or create an
 * empty project and build it up by hand. The dialog asks for exactly what the compiler needs (a
 * title, a narrator archetype, a theme and a voice) and shows the run time the pasted script
 * implies, so the user knows what they are about to get before they commit.
 */

import { useState } from "react";
import type { Film } from "../../../src/dl/schema";
import { AlertTriangle, Bot, FileText, Plus, Sparkles } from "lucide-react";
import { Badge, Button, Card, Field, Input, Modal, Note, SegmentedTabs, Select, Spinner, Stat, Textarea, cn } from "./ui";

export interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (film: Film, script: string) => void;
}

const ARCHETYPES = [
  {
    id: "astronaut",
    name: "Astronaut Guide",
    domain: "Space, Physics & Exploration",
  },
  {
    id: "developer",
    name: "Lead Engineer",
    domain: "Software, Cloud & Infrastructure",
  },
  {
    id: "dataEngineer",
    name: "Data Architect",
    domain: "Data, Databases & Pipelines",
  },
  {
    id: "scientist",
    name: "Research Scientist",
    domain: "AI, Math & Hardware Architecture",
  },
  {
    id: "executive",
    name: "Tech Executive",
    domain: "Leadership, Strategy & Vision",
  },
  {
    id: "robot",
    name: "Cyber Robot",
    domain: "Robotics, Algorithms & State Machines",
  },
  {
    id: "educator",
    name: "Academic Tutor",
    domain: "Concepts, Tutorials & Walkthroughs",
  },
  {
    id: "mascot",
    name: "Creative Mascot",
    domain: "Branding, Product & Culture",
  },
];

const THEMES = [
  {
    id: "smooth-dark",
    name: "Smooth Dark",
    accent: "#FF6B00",
    swatch: "#0A0A0B",
  },
  {
    id: "paper-white",
    name: "Paper White",
    accent: "#635BFF",
    swatch: "#F5F5F5",
  },
  {
    id: "blueprint-grid",
    name: "Blueprint",
    accent: "#00E5FF",
    swatch: "#F5F5F5",
  },
  {
    id: "subtle-dots",
    name: "Terminal Dots",
    accent: "#10B981",
    swatch: "#F5F5F5",
  },
];

const VOICES = [
  { id: "kokoro-am_adam", name: "Kokoro: Adam (Technical - Male)" },
  { id: "kokoro-af_bella", name: "Kokoro: Bella (Explainer - Female)" },
  { id: "kokoro-af_nicole", name: "Kokoro: Nicole (Tech - Female)" },
  { id: "kokoro-am_michael", name: "Kokoro: Michael (Narrative - Male)" },
  { id: "aura-helios-en", name: "Deepgram: Helios (Tech Lead - Male)" },
  { id: "aura-asteria-en", name: "Deepgram: Asteria (Narrative - Female)" },
];

/** Dialog for creating a project, optionally compiling a first cut from a pasted script. */
export function NewProjectModal({
  isOpen,
  onClose,
  onProjectCreated,
}: NewProjectModalProps) {
  const [tab, setTab] = useState<"intake" | "blank">("intake");
  const [title, setTitle] = useState<string>("");
  const [slug, setSlug] = useState<string>("");
  const [script, setScript] = useState<string>("");
  const [characterId, setCharacterId] = useState<string>("developer");
  const [themeId, setThemeId] = useState<string>("smooth-dark");
  const [voiceId, setVoiceId] = useState<string>("kokoro-am_adam");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok)
        throw new Error(data.error || "Failed to create and compile project.");

      onProjectCreated(data.film, data.script);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      dismissible={!isSubmitting}
      title="New project"
      subtitle="Start from a script, or start empty and build it up."
      icon={<Plus className="h-5 w-5" />}
      width="max-w-3xl"
      footer={
        <>
          <Button size="md" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button size="md" tone="primary" disabled={isSubmitting || !title.trim()} onClick={handleCreate}>
            {isSubmitting ? <Spinner /> : <Sparkles className="h-4 w-4" />}
            {isSubmitting
              ? "Compiling"
              : tab === "intake" && script.trim()
                ? "Create and compile"
                : "Create project"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleCreate} className="flex flex-col gap-4">
        <SegmentedTabs
          ariaLabel="How to start"
          value={tab}
          onChange={setTab}
          items={[
            { value: "intake", label: "From a script", icon: <FileText className="h-3.5 w-3.5" /> },
            { value: "blank", label: "Empty project", icon: <Plus className="h-3.5 w-3.5" /> },
          ]}
        />

        {error ? (
          <Note tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
            {error}
          </Note>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Project title" htmlFor="np-title" hint="Shown in the switcher and burned into the film.">
            <Input
              id="np-title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Why attention scales"
              autoFocus
            />
          </Field>
          <Field label="Identifier" htmlFor="np-slug" hint="Lowercase letters, digits and dashes. Used for file paths.">
            <Input
              id="np-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="why-attention-scales"
            />
          </Field>
        </div>

        {tab === "intake" ? (
          <Field
            label="Script"
            htmlFor="np-script"
            aside={`${wordCount} words, about ${estimatedTimeFormatted}`}
            hint="Paste a screenplay or plain narration. Aideos compiles scenes, canvas nodes and shot timings from it."
          >
            <Textarea
              id="np-script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={9}
              placeholder="## 0:00 - The hook&#10;[NARRATION] Ask an image model to change one thing..."
              spellCheck={false}
            />
          </Field>
        ) : (
          <Note tone="quiet" icon={<FileText className="h-3.5 w-3.5" />}>
            An empty project starts with one placeholder shot. Write the script in the Script stage afterwards.
          </Note>
        )}

        <div>
          <p className="mb-1.5 font-sans text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-soft">
            Narrator archetype
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {ARCHETYPES.map((a) => (
              <Card
                key={a.id}
                interactive
                selected={characterId === a.id}
                onClick={() => setCharacterId(a.id)}
                className="flex flex-col gap-0.5 p-2"
              >
                <span className="flex items-center gap-1 font-sans text-[11px] font-extrabold">
                  <Bot className="h-3 w-3 shrink-0" />
                  {a.name}
                </span>
                <span className={cn("font-sans text-[9px] leading-snug", characterId === a.id ? "opacity-90" : "text-ink-mute")}>
                  {a.domain}
                </span>
              </Card>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 font-sans text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-soft">
              Theme
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {THEMES.map((t) => (
                <Card
                  key={t.id}
                  interactive
                  selected={themeId === t.id}
                  onClick={() => setThemeId(t.id)}
                  className="flex items-center gap-2 p-2"
                >
                  <span
                    className="h-5 w-5 shrink-0 border-2 border-ink"
                    style={{ backgroundColor: t.accent }}
                    aria-hidden
                  />
                  <span className="truncate font-sans text-[11px] font-extrabold">{t.name}</span>
                </Card>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Field label="Narration voice" htmlFor="np-voice">
              <Select id="np-voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="border-2 border-ink bg-paper-3 p-2.5">
              <Stat label="Words" value={wordCount} />
              <Stat label="Estimated run time" value={estimatedTimeFormatted} tone="select" />
              <Stat label="Accent" value={activeTheme.accent} />
              <div className="mt-1.5">
                <Badge tone="quiet">{tab === "intake" ? "Compiles scenes on create" : "Starts empty"}</Badge>
              </div>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
