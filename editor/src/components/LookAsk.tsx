/**
 * File Description: The Ask box of the Look stage. It shows the chosen shot as a looping picture and one input under it. The text goes to the connected coding agent (the existing agent link, falling back to the server model when none is connected) as a design task for that shot. The agent edits the film's own design, and the change reaches the film only when it passes the design check. The last Ask for the shot shows its state, with Undo.
 * Inputs and outputs: film, chosen shot, request text -> a design request for that shot, the request state and the looping shot picture.
 * Used by: editor/src/screens/LookStage.tsx.
 */

import { DEFAULT_FPS } from "../../../src/dl/defaults";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { Bot, RotateCcw } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { FilmView } from "../../../src/dl/Film";
import { buildTimeline } from "../../../src/dl/camera";
import { captionWordsForFilm } from "../../../src/dl/captionsParser";
import { previewAccent } from "../../../src/projectTheme";
import { Badge, Button, Input, Panel, PanelBody, Select, Spinner, type NoteTone } from "./ui";

interface AskRequest {
  id: string;
  shotId: string;
  prompt: string;
  by: "agent" | "server-model" | "none";
  state: "sent" | "passed" | "failed" | "undelivered" | "reverted";
  message?: string;
}

const STATE_TONE: Record<AskRequest["state"], "success" | "danger" | "info" | "warn" | "quiet"> = {
  passed: "success",
  failed: "danger",
  sent: "info",
  undelivered: "warn",
  reverted: "quiet",
};

const STATE_LABEL: Record<AskRequest["state"], string> = {
  passed: "Pass",
  failed: "Fail",
  sent: "Working",
  undelivered: "Not sent",
  reverted: "Undone",
};

export interface LookAskProps {
  film: Film;
  shotId: string;
  onShotChange: (id: string) => void;
  notify: (tone: NoteTone, text: string) => number;
}

/** The chosen shot as a looping picture, with the one Ask input under it. */
export function LookAsk({ film, shotId, onShotChange, notify }: LookAskProps) {
  const [text, setText] = useState("");
  const [requests, setRequests] = useState<AskRequest[]>([]);
  const [sending, setSending] = useState(false);
  const [agent, setAgent] = useState<{ online: boolean; label?: string } | null>(null);
  const fps = film.fps || DEFAULT_FPS;

  const timeline = useMemo(() => {
    try {
      return buildTimeline(film, film.voiceover?.durationSec);
    } catch {
      return null;
    }
  }, [film]);
  const timed = timeline?.find((t) => t.shot.id === shotId);
  const captionWords = useMemo(() => captionWordsForFilm(film), [film]);

  // Reads the Ask log of this film. A failed read keeps the last list.
  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/design/${film.id}/motion`);
      const body = await res.json();
      if (res.ok) setRequests(body.requests as AskRequest[]);
    } catch {
      // The list is a convenience. A failed refresh keeps the last one.
    }
  }, [film.id]);

  // Refresh the log, faster while the agent works.
  const working = requests.some((r) => r.state === "sent");
  useEffect(() => {
    void loadRequests();
    const timer = window.setInterval(() => void loadRequests(), working ? 4000 : 15000);
    return () => window.clearInterval(timer);
  }, [loadRequests, working]);

  // Check whether an agent is connected.
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/agent-link/status");
        const status = await res.json();
        setAgent({ online: Boolean(status.connected && status.online), label: status.agentLabel });
      } catch {
        setAgent(null);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  // Sends the text to the agent as a design task for the chosen shot.
  const send = async () => {
    if (!text.trim() || !shotId || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/design/${film.id}/shots/${shotId}/motion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, film }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const request = body.request as AskRequest;
      notify(request.state === "undelivered" ? "warn" : "info", request.message ?? "Sent");
      if (request.state !== "undelivered") setText("");
      await loadRequests();
    } catch (err) {
      notify("danger", `Not sent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  };

  // Puts back the design from before an Ask.
  const undo = async (id: string) => {
    try {
      const res = await fetch(`/api/design/${film.id}/motion/${id}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      notify("success", "Undone. The film reloads.");
      await loadRequests();
    } catch (err) {
      notify("danger", `Not undone: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const last = requests.find((r) => r.shotId === shotId);
  const undoable = last?.state === "passed" && requests.find((r) => r.state === "passed")?.id === last.id;

  return (
    <Panel>
      <PanelBody scroll={false} className="flex flex-col gap-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={shotId}
            onChange={(e) => onShotChange(e.target.value)}
            aria-label="Shot"
            className="h-8 min-w-0 flex-1 py-0 text-xs"
          >
            {(timeline ?? []).map((t) => (
              <option key={t.shot.id} value={t.shot.id}>
                {t.shot.id}
              </option>
            ))}
          </Select>
          {agent?.online ? (
            <Badge tone="success" icon={<Bot className="h-3 w-3" />}>
              {agent.label ?? "Agent"}
            </Badge>
          ) : (
            <Badge tone="warn" icon={<Bot className="h-3 w-3" />} title="Connect an agent in the header.">
              No agent
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-center bg-matte">
          {timeline && timed ? (
            <Player
              key={`${film.id}-${shotId}`}
              component={FilmView}
              inputProps={{
                film,
                timeline,
                accent: previewAccent(film),
                showGrid: film.theme?.videoType === "case-study",
                showRail: true,
                captionWords,
              }}
              durationInFrames={Math.max(1, timeline[timeline.length - 1].to)}
              inFrame={timed.from}
              outFrame={Math.max(timed.from, timed.to - 1)}
              initialFrame={timed.from}
              fps={fps}
              compositionWidth={1920}
              compositionHeight={1080}
              style={{ width: "100%", aspectRatio: "16 / 9" }}
              controls
              loop
              clickToPlay
              acknowledgeRemotionLicense
            />
          ) : (
            <p className="p-6 font-mono text-xs text-matte-text">No picture.</p>
          )}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Ask: change ${shotId || "a shot"}...`}
            aria-label="Ask"
            disabled={sending}
          />
          <Button type="submit" tone="primary" size="sm" disabled={sending || !text.trim() || !shotId}>
            {sending ? <Spinner /> : null}
            Ask
          </Button>
        </form>

        {last ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATE_TONE[last.state]}>{STATE_LABEL[last.state]}</Badge>
            {last.message ? <span className="min-w-0 flex-1 font-mono text-xs leading-snug text-ink-soft">{last.message}</span> : null}
            {undoable ? (
              <Button size="xs" onClick={() => void undo(last.id)} title="Put back the design from before this Ask.">
                <RotateCcw className="h-3 w-3" />
                Undo
              </Button>
            ) : null}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
