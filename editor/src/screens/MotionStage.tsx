/**
 * File Description: Motion stage for Aideos Studio: the SVG animation authoring surface.
 * A human writes animated SVG here, scrubs it frame by frame against a real clock, saves it into
 * the film's video package, and drops it onto the timeline as a clip. Scrubbing is exact rather
 * than approximate: SMIL animation is driven through the SVG element's own `setCurrentTime`, and
 * CSS animation is seeked with a negative delay while paused, so the frame shown is the frame that
 * will render. This screen owns authoring only; the render engine that turns a saved visual into
 * footage lives outside the editor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CirclePlay,
  FilePlus2,
  Pause,
  Play,
  RefreshCw,
  Save,
  Shapes,
  SquareDashedBottomCode,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  NumberStepper,
  Note,
  Panel,
  PanelBody,
  PanelHeader,
  Range,
  SegmentedTabs,
  Textarea,
  Toolbar,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarLabel,
  type NoteTone,
} from "../components/ui";
import { MOTION_TEMPLATES, type MotionTemplate } from "./motionTemplates";

export interface SavedVisual {
  name: string;
  src: string;
  sizeBytes: number;
  updatedAt: number;
}

export interface MotionStageProps {
  film: Film;
  commit: (next: Film, label: string) => void;
  notify: (tone: NoteTone, text: string) => number;
}

/** Validate SVG markup in the browser and report the first parser error in plain language. */
function validateSvg(markup: string): { ok: boolean; error?: string } {
  if (!markup.includes("<svg")) return { ok: false, error: "The markup needs an <svg> root element." };
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    return { ok: false, error: parserError.textContent?.split("\n")[0] ?? "The SVG could not be parsed." };
  }
  if (/<script/i.test(markup)) {
    return { ok: false, error: "Scripts are not allowed inside a visual. Use <animate> or CSS animation." };
  }
  return { ok: true };
}

/** Live SVG stage that renders markup and holds it at an exact time for scrubbing. */
function SvgScrubStage({ markup, timeSec, playing }: { markup: string; timeSec: number; playing: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Re-mount the markup whenever it changes, then seek it to the requested time.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = markup;
    const svg = host.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.style.display = "block";
    }
  }, [markup]);

  useEffect(() => {
    const host = hostRef.current;
    const svg = host?.querySelector("svg") as (SVGSVGElement & { setCurrentTime?: (t: number) => void }) | null;
    if (!svg) return;

    // SMIL: seek the document clock directly, which is frame exact.
    if (typeof svg.setCurrentTime === "function") {
      if (playing) svg.unpauseAnimations?.();
      else svg.pauseAnimations?.();
      svg.setCurrentTime(timeSec);
    }

    // CSS animation: a negative delay on a paused animation seeks to that offset.
    const animated = host?.querySelectorAll<SVGElement | HTMLElement>("*") ?? [];
    animated.forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.animationName && style.animationName !== "none") {
        el.style.animationPlayState = playing ? "running" : "paused";
        if (!playing) el.style.animationDelay = `${-timeSec}s`;
        else el.style.animationDelay = "";
      }
    });
  }, [markup, playing, timeSec]);

  return <div ref={hostRef} className="h-full w-full" aria-label="SVG animation preview" />;
}

/** Author, scrub, save and place custom SVG animations. */
export function MotionStage({ film, commit, notify }: MotionStageProps) {
  const fps = film.fps || 30;
  const [name, setName] = useState("my-animation");
  const [markup, setMarkup] = useState<string>(MOTION_TEMPLATES[0].svg);
  const [durationSec, setDurationSec] = useState(3);
  const [timeSec, setTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<"code" | "templates">("templates");
  const [visuals, setVisuals] = useState<SavedVisual[]>([]);
  const [saving, setSaving] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const validation = useMemo(() => validateSvg(markup), [markup]);

  /** Reload the list of visuals already saved into this film's package. */
  const refreshVisuals = useCallback(async () => {
    try {
      const res = await fetch(`/api/visuals?filmId=${encodeURIComponent(film.id)}`);
      const data = await res.json();
      if (data.ok) setVisuals(data.visuals as SavedVisual[]);
    } catch {
      // The list is a convenience; a failure here must not block authoring.
    }
  }, [film.id]);

  useEffect(() => {
    void refreshVisuals();
  }, [refreshVisuals]);

  // Loop playback across the declared duration so the animation can be judged in motion.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();
    /** Advance the preview clock by real elapsed time, wrapping at the declared duration. */
    const tick = () => {
      const now = performance.now();
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setTimeSec((prev) => {
        const next = prev + delta;
        return next >= durationSec ? next % durationSec : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [durationSec, playing]);

  /** Load a starter template into the editor. */
  const applyTemplate = (template: MotionTemplate) => {
    setMarkup(template.svg);
    setDurationSec(template.durationSec);
    setName(template.id);
    setTimeSec(0);
    setView("code");
  };

  /** Write the current markup into the film's video package. */
  const saveVisual = useCallback(async () => {
    if (!validation.ok) {
      notify("danger", validation.error ?? "Fix the SVG before saving.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/visuals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filmId: film.id, name, svg: markup }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed");
      notify("success", `Saved ${data.name}.svg into the ${film.id} package`);
      await refreshVisuals();
    } catch (err) {
      notify("danger", `Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [film.id, markup, name, notify, refreshVisuals, validation]);

  /** Delete a saved visual from the package. */
  const deleteVisual = useCallback(
    async (visual: SavedVisual) => {
      try {
        await fetch("/api/visuals/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filmId: film.id, name: visual.name }),
        });
        notify("info", `Removed ${visual.name}.svg`);
        await refreshVisuals();
      } catch (err) {
        notify("danger", `Could not remove: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [film.id, notify, refreshVisuals],
  );

  /** Attach a saved visual to a shot as an inset so it becomes part of the film. */
  const placeOnShot = useCallback(
    (visual: SavedVisual, shotId: string) => {
      const shots = film.shots.map((shot) =>
        shot.id === shotId
          ? {
              ...shot,
              blocks: [
                ...shot.blocks.filter((b) => !(b.c === "AnalogyInset" && (b as { src?: string }).src === visual.src)),
                { c: "AnalogyInset", src: visual.src, caption: visual.name } as (typeof shot.blocks)[number],
              ],
            }
          : shot,
      );
      commit({ ...film, shots }, `Place ${visual.name} on ${shotId}`);
      notify("success", `Placed ${visual.name} on ${shotId}`);
    },
    [commit, film, notify],
  );

  const frame = Math.round(timeSec * fps);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Toolbar seam="bottom">
        <ToolbarGroup>
          <ToolbarLabel>Source</ToolbarLabel>
          <SegmentedTabs
            ariaLabel="Motion source"
            value={view}
            onChange={setView}
            items={[
              { value: "templates", label: "Templates", icon: <Shapes className="h-3.5 w-3.5" /> },
              { value: "code", label: "SVG", icon: <SquareDashedBottomCode className="h-3.5 w-3.5" /> },
            ]}
          />
        </ToolbarGroup>
        <ToolbarDivider />
        <ToolbarGroup>
          <Button
            size="sm"
            tone={playing ? "warn" : "success"}
            onClick={() => setPlaying((p) => !p)}
            title={playing ? "Pause the preview" : "Play the preview"}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button size="sm" onClick={() => setTimeSec(0)} title="Return the preview to the first frame">
            <RefreshCw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <span className="border-2 border-ink bg-paper-3 px-2 py-1 font-mono text-[11px] font-bold tabular-nums">
            {timeSec.toFixed(2)}s / frame {frame}
          </span>
        </ToolbarGroup>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" tone="primary" onClick={() => void saveVisual()} disabled={saving || !validation.ok}>
            <Save className="h-3.5 w-3.5" />
            Save to package
          </Button>
        </div>
      </Toolbar>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col gap-3">
          <Panel className="min-h-[280px] flex-1">
            <PanelHeader
              title="Preview"
              accent
              actions={<Badge tone="neutral">{durationSec.toFixed(1)}s loop</Badge>}
            />
            <PanelBody bare className="flex min-h-0 flex-col">
              <div className="nb-hatch flex min-h-[220px] flex-1 items-center justify-center bg-paper-3 p-4">
                {validation.ok ? (
                  <div className="h-full max-h-[420px] w-full max-w-[640px]">
                    <SvgScrubStage markup={markup} timeSec={timeSec} playing={playing} />
                  </div>
                ) : (
                  <Note tone="danger" icon={<TriangleAlert className="h-3.5 w-3.5" />}>
                    {validation.error}
                  </Note>
                )}
              </div>
              <div className="flex items-center gap-3 border-t-2 border-ink bg-paper px-3 py-2">
                <span className="shrink-0 font-sans text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-soft">
                  Scrub
                </span>
                <Range
                  className="flex-1"
                  min={0}
                  max={durationSec}
                  step={1 / fps}
                  value={Math.min(timeSec, durationSec)}
                  onChange={(e) => {
                    setPlaying(false);
                    setTimeSec(Number(e.target.value));
                  }}
                  aria-label="Scrub the animation"
                />
                <NumberStepper
                  value={durationSec}
                  min={0.2}
                  max={30}
                  step={0.5}
                  precision={1}
                  unit="s"
                  onChange={setDurationSec}
                  title="Loop length used for preview and for the clip placed on the timeline"
                />
              </div>
            </PanelBody>
          </Panel>

          {view === "code" ? (
            <Panel className="min-h-[240px]">
              <PanelHeader
                title="SVG source"
                actions={
                  <Badge tone={validation.ok ? "success" : "danger"}>{validation.ok ? "Valid" : "Invalid"}</Badge>
                }
              />
              <PanelBody bare className="min-h-0 p-2">
                <Textarea
                  value={markup}
                  onChange={(e) => setMarkup(e.target.value)}
                  spellCheck={false}
                  className="h-[260px] resize-none text-[11px] leading-relaxed"
                  aria-label="SVG markup"
                />
                <p className="mt-1.5 font-sans text-[10px] leading-snug text-ink-mute">
                  Animate with SMIL (&lt;animate&gt;, &lt;animateTransform&gt;) for exact scrubbing, or with CSS
                  keyframes inside a &lt;style&gt; block. Scripts are rejected.
                </p>
              </PanelBody>
            </Panel>
          ) : (
            <Panel className="min-h-[240px]">
              <PanelHeader title="Start from a template" />
              <PanelBody className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
                {MOTION_TEMPLATES.map((t) => (
                  <Card
                    key={t.id}
                    interactive
                    onClick={() => applyTemplate(t)}
                    className="flex flex-col gap-1 p-2"
                  >
                    <span className="font-sans text-[11px] font-extrabold uppercase tracking-[0.04em]">{t.label}</span>
                    <span className="font-sans text-[10px] leading-snug text-ink-soft">{t.description}</span>
                    <span className="mt-1 font-mono text-[9px] text-ink-mute">{t.durationSec.toFixed(1)}s</span>
                  </Card>
                ))}
              </PanelBody>
            </Panel>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel>
            <PanelHeader title="Visual details" />
            <PanelBody scroll={false} className="flex flex-col gap-2 p-2">
              <Field label="Name" hint="Saved as videos/{film}/visuals/{name}.svg">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="orbiting-nodes"
                  aria-label="Visual name"
                />
              </Field>
              <Button size="sm" block onClick={() => applyTemplate(MOTION_TEMPLATES[0])}>
                <FilePlus2 className="h-3.5 w-3.5" />
                Start over from a template
              </Button>
            </PanelBody>
          </Panel>

          <Panel className="min-h-0 flex-1">
            <PanelHeader
              title="Saved in this package"
              actions={<Badge tone="quiet">{visuals.length}</Badge>}
            />
            <PanelBody className="flex flex-col gap-2 p-2">
              {visuals.length === 0 ? (
                <EmptyState
                  icon={<Shapes className="h-5 w-5" />}
                  title="No visuals yet"
                  description="Author an animation on the left and save it. Saved visuals can be placed on any shot."
                  className="min-h-[180px]"
                />
              ) : (
                visuals.map((v) => (
                  <Card key={v.name} className="flex flex-col gap-1.5 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-sans text-[11px] font-extrabold">{v.name}</span>
                      <span className="shrink-0 font-mono text-[9px] text-ink-mute">
                        {(v.sizeBytes / 1024).toFixed(1)}kb
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        size="xs"
                        onClick={() => {
                          void fetch(`/${v.src}`)
                            .then((r) => r.text())
                            .then((text) => {
                              setMarkup(text);
                              setName(v.name);
                              setView("code");
                            })
                            .catch(() => notify("danger", `Could not open ${v.name}`));
                        }}
                      >
                        <CirclePlay className="h-3 w-3" />
                        Open
                      </Button>
                      <select
                        aria-label={`Place ${v.name} on a shot`}
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) placeOnShot(v, e.target.value);
                          e.target.value = "";
                        }}
                        className="h-6 min-w-0 flex-1 border-2 border-ink bg-paper-3 px-1 font-mono text-[10px] text-ink"
                      >
                        <option value="">Place on shot...</option>
                        {film.shots.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.id}
                          </option>
                        ))}
                      </select>
                      <Button size="xs" tone="danger" iconOnly onClick={() => void deleteVisual(v)} title="Delete">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
