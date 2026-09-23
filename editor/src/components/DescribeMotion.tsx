/**
 * File Description: Motion you describe - the Motion stage's default view.
 * Pick a shot, say what should move, and the connected coding agent (or the server model when none
 * is connected) edits the film's own design to do it: static artwork plus clips cued to the words,
 * built only when it passes the design check. The real film loops the chosen shot on the left, so a
 * finished motion shows up there as soon as the studio reloads the film. Every request is listed
 * with what came of it, with Refine (start from that request's words) and Revert.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { Bot, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { FilmView } from "../../../src/dl/Film";
import { buildTimeline } from "../../../src/dl/camera";
import { generateWordsFromFilm } from "../../../src/dl/captionsParser";
import { Badge, Button, EmptyState, Note, Panel, PanelBody, PanelHeader, Select, Textarea, Toolbar, ToolbarGroup, ToolbarLabel, type NoteTone } from "./ui";

/** Starting points: each fills the prompt, never code. */
const STARTERS: Array<{ label: string; prompt: string }> = [
  { label: "Pulse the idea", prompt: "Let the main idea pulse gently while the narrator lingers on it." },
  { label: "Draw a connection", prompt: "Draw a line between the two things as the narrator connects them, landing on the word that joins them." },
  { label: "Bars growing", prompt: "Grow a bar for each number as it is spoken, one after another." },
  { label: "Orbiting cluster", prompt: "Have small satellites circle the core idea to show it is a cluster of parts." },
  { label: "Type it on", prompt: "Type the text on screen word by word, in time with the narrator reading it." },
  { label: "Split compare", prompt: "Slide the old approach and the new one apart when the narrator compares them." },
];

interface MotionRequest {
  id: string;
  shotId: string;
  prompt: string;
  at: string;
  by: "agent" | "server-model" | "none";
  state: "sent" | "passed" | "failed" | "undelivered" | "reverted";
  message?: string;
}

const STATE_TONE: Record<MotionRequest["state"], "success" | "danger" | "info" | "warn" | "quiet"> = {
  passed: "success",
  failed: "danger",
  sent: "info",
  undelivered: "warn",
  reverted: "quiet",
};

const STATE_LABEL: Record<MotionRequest["state"], string> = {
  passed: "Passed",
  failed: "Failed",
  sent: "Working",
  undelivered: "Not sent",
  reverted: "Reverted",
};

// Formats seconds as m:ss.
function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface DescribeMotionProps {
  film: Film;
  notify: (tone: NoteTone, text: string) => number;
}

/** Describe a motion for a shot and send it to the agent. */
export function DescribeMotion({ film, notify }: DescribeMotionProps) {
  const [shotId, setShotId] = useState(film.shots[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [requests, setRequests] = useState<MotionRequest[]>([]);
  const [sending, setSending] = useState(false);
  const [agent, setAgent] = useState<{ online: boolean; label?: string } | null>(null);

  // Keep the chosen shot valid when the film changes under us.
  useEffect(() => {
    if (!film.shots.some((s) => s.id === shotId)) setShotId(film.shots[0]?.id ?? "");
  }, [film.shots, shotId]);

  const timeline = useMemo(() => {
    try {
      return buildTimeline(film, film.voiceover?.durationSec);
    } catch {
      return null;
    }
  }, [film]);
  const timed = timeline?.find((t) => t.shot.id === shotId);
  const captionWords = useMemo(() => generateWordsFromFilm(film as unknown as Record<string, unknown>), [film]);
  const fps = film.fps || 30;

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/design/${film.id}/motion`);
      const body = await res.json();
      if (res.ok) setRequests(body.requests as MotionRequest[]);
    } catch {
      // The list is a convenience; a failed refresh keeps the last one.
    }
  }, [film.id]);

  // Refresh the list, faster while something is being worked on; check the agent too.
  const working = requests.some((r) => r.state === "sent");
  useEffect(() => {
    void loadRequests();
    const t = window.setInterval(() => void loadRequests(), working ? 4000 : 15000);
    return () => window.clearInterval(t);
  }, [loadRequests, working]);
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/agent-link/status");
        const s = await res.json();
        setAgent({ online: Boolean(s.connected && s.online), label: s.agentLabel });
      } catch {
        setAgent(null);
      }
    };
    void check();
    const t = window.setInterval(() => void check(), 15000);
    return () => window.clearInterval(t);
  }, []);

  const send = async () => {
    if (!prompt.trim() || !shotId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/design/${film.id}/shots/${shotId}/motion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, film }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const r = body.request as MotionRequest;
      notify(r.state === "undelivered" ? "warn" : "info", r.message ?? "Sent");
      if (r.state !== "undelivered") setPrompt("");
      await loadRequests();
    } catch (err) {
      notify("danger", `Could not send: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  };

  const revert = async (id: string) => {
    try {
      const res = await fetch(`/api/design/${film.id}/motion/${id}/revert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      notify("success", "Reverted. The film reloads with the previous design.");
      await loadRequests();
    } catch (err) {
      notify("danger", `Could not revert: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const shot = film.shots.find((s) => s.id === shotId);
  const lastRevertable = requests.find((r) => r.state === "passed");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Toolbar seam="bottom">
        <ToolbarGroup>
          <ToolbarLabel>Shot</ToolbarLabel>
          <Select value={shotId} onChange={(e) => setShotId(e.target.value)} aria-label="Target shot" className="w-[320px] max-w-[50vw]">
            {(timeline ?? []).map((t) => (
              <option key={t.shot.id} value={t.shot.id}>
                {t.shot.id} · {clock(t.from / fps)} · {(t.shot.scriptText ?? "").slice(0, 48)}
              </option>
            ))}
          </Select>
        </ToolbarGroup>
        <span className="ml-auto">
          {agent?.online ? (
            <Badge tone="success" icon={<Bot className="h-3 w-3" />}>
              {agent.label}
            </Badge>
          ) : (
            <Badge tone="warn" icon={<Bot className="h-3 w-3" />} title="Use Connect agent in the header">
              No agent connected
            </Badge>
          )}
        </span>
      </Toolbar>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:overflow-hidden">
        <Panel className="min-h-[320px] lg:min-h-0">
          <PanelHeader title={`Preview - the film at ${shotId || "..."}`} accent>
            {timed ? <Badge tone="quiet">{clock(timed.from / fps)}-{clock(timed.to / fps)}</Badge> : null}
          </PanelHeader>
          <PanelBody bare scroll={false} className="flex flex-col">
            <div className="flex min-h-0 flex-1 items-center justify-center bg-matte p-3">
              {timeline && timed ? (
                <Player
                  key={`${film.id}-${shotId}`}
                  component={FilmView}
                  inputProps={{ film, timeline, accent: film.accent ?? "#635BFF", showGrid: film.theme?.videoType === "case-study", showRail: true, captionWords }}
                  durationInFrames={Math.max(1, timeline[timeline.length - 1].to)}
                  inFrame={timed.from}
                  outFrame={Math.max(timed.from, timed.to - 1)}
                  initialFrame={timed.from}
                  fps={fps}
                  compositionWidth={1920}
                  compositionHeight={1080}
                  style={{ width: "100%", aspectRatio: "16 / 9", maxHeight: "100%" }}
                  controls
                  loop
                  clickToPlay
                  acknowledgeRemotionLicense
                />
              ) : (
                <p className="font-mono text-xs text-matte-text">This film's timeline could not be built.</p>
              )}
            </div>
            {shot?.scriptText ? (
              <p className="border-t-2 border-ink bg-paper-3 px-3 py-2 font-sans text-[12px] leading-snug text-ink">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-soft">Says </span>
                {shot.scriptText}
              </p>
            ) : null}
          </PanelBody>
        </Panel>

        <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto">
          <Panel>
            <PanelHeader title="What should move?" icon={<Wand2 className="h-3.5 w-3.5" />} />
            <PanelBody scroll={false} className="flex flex-col gap-2.5">
              <Textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`e.g. When the narrator says the key phrase in ${shotId}, draw the path between the two ideas and light up the second one.`}
                aria-label="Describe the motion"
              />
              <div className="flex flex-wrap gap-1.5">
                {STARTERS.map((s) => (
                  <Button key={s.label} size="xs" onClick={() => setPrompt(s.prompt)} title={s.prompt}>
                    {s.label}
                  </Button>
                ))}
              </div>
              <Button tone="primary" size="sm" onClick={() => void send()} disabled={sending || !prompt.trim() || !shotId}>
                <Sparkles className="h-3.5 w-3.5" />
                {sending ? "Sending..." : agent?.online ? `Generate with ${agent.label}` : "Generate"}
              </Button>
              {!agent?.online ? (
                <Note tone="warn">No agent is connected, so the server model will try (when one is configured). Connect your own agent from the header for better results.</Note>
              ) : null}
              <p className="text-[11px] leading-snug text-ink-mute">
                The motion is written into this film's design (static artwork plus clips cued to the words) and only reaches the film once it passes the design check.
              </p>
            </PanelBody>
          </Panel>

          <Panel className="min-h-[200px]">
            <PanelHeader title="Requests">
              <Badge tone="quiet">{requests.length}</Badge>
            </PanelHeader>
            <PanelBody bare>
              {requests.length === 0 ? (
                <EmptyState title="Nothing asked for yet" description="Describe a motion above; each request and what came of it is listed here." />
              ) : (
                <ol className="divide-y-2 divide-ink">
                  {requests.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Badge>
                        <Badge tone="neutral">{r.shotId}</Badge>
                        <span className="font-mono text-[10px] text-ink-mute">
                          {r.by === "agent" ? "agent" : r.by === "server-model" ? "server model" : "not sent"} · {new Date(r.at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="font-sans text-[12.5px] leading-snug text-ink">{r.prompt}</p>
                      {r.message ? <p className="font-mono text-[10.5px] leading-snug text-ink-soft">{r.message}</p> : null}
                      <div className="flex gap-1.5">
                        <Button
                          size="xs"
                          onClick={() => {
                            setShotId(r.shotId);
                            setPrompt(`${r.prompt}\nRefine: `);
                          }}
                        >
                          Refine
                        </Button>
                        {r.state === "passed" && lastRevertable?.id === r.id ? (
                          <Button size="xs" onClick={() => void revert(r.id)} title="Put back the design from before this request">
                            <RotateCcw className="h-3 w-3" /> Revert
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
