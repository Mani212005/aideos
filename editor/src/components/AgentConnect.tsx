/**
 * File Description: The header's agent badge and the Connect your coding agent dialog.
 * The badge always tells the truth about who does the studio's agent work, including the honest
 * middle states: "reconnecting" while a restarted server waits for the agent's next check-in, and
 * "offline" when the agent has gone quiet. The dialog offers two ways to link, the primary being
 * the user's own running agent session (add the studio's MCP endpoint, paste one line, watch the
 * work in that agent's own UI) and the secondary the downloadable connector. Polling the status is
 * also this browser's heartbeat: the link ends when the studio tab stops asking, or on Disconnect.
 */

import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, Unplug } from "lucide-react";
import { Badge, Button, Modal, Note, Spinner } from "./ui";
import { linkPhase, readExpectedLink, readOwnerKey, rotateOwnerKey, writeExpectedLink, writeOwnerKey } from "../state/agentLink";

type Agent = "claude" | "agy" | "codex" | "opencode";
type Way = "agent" | "connector";

const AGENTS: Array<{ id: Agent; label: string; runs: string }> = [
  { id: "claude", label: "Claude Code", runs: "claude" },
  { id: "agy", label: "Antigravity", runs: "agy" },
  { id: "codex", label: "Codex", runs: "codex" },
  { id: "opencode", label: "OpenCode", runs: "opencode" },
];

interface LinkStatus {
  startedAt?: string;
  connected: boolean;
  online: boolean;
  mode?: "connector" | "agent";
  agentLabel?: string;
  machine?: string;
  lastSeen?: string;
  busy?: boolean;
  pending: number;
  lastResult?: { taskId: string; ok: boolean; summary: string; at: string };
  activity?: Array<{ seq: number; at: string; text: string }>;
}

interface Pairing {
  way: Way;
  agent: Agent;
  startedAt: number;
  expiresAt?: string;
  /** Connector: the terminal command. */
  command?: string;
  /** Agent: the add-MCP command, where to run it, and the line to paste into the agent. */
  addCommand?: string;
  addHint?: string;
  prompt?: string;
}

// Formats how long ago an ISO time was.
function ago(iso?: string): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Reads the owner's connection status from the studio (null when the studio itself is unreachable).
async function fetchStatus(): Promise<LinkStatus | null> {
  if (!readOwnerKey()) return { connected: false, online: false, pending: 0 };
  try {
    const res = await fetch("/api/agent-link/status");
    return res.ok ? ((await res.json()) as LinkStatus) : null;
  } catch {
    return null;
  }
}

// A code block with a copy button.
function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex items-stretch gap-1.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre border-2 border-ink bg-sunken px-2.5 py-2 font-mono text-[11px] text-ink">{text}</code>
      <Button size="sm" iconOnly onClick={() => void copy()} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

/** Header badge plus the link dialog. */
export function AgentConnect() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<Agent>("claude");
  const [way, setWay] = useState<Way>("agent");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expected, setExpected] = useState(readExpectedLink());

  const refresh = useCallback(async () => {
    const next = await fetchStatus();
    setStatus(next);
    if (next?.connected && next.online) {
      const link = { agentLabel: next.agentLabel ?? "agent", machine: next.machine ?? "", lastOnline: Date.now() };
      writeExpectedLink(link);
      setExpected(link);
    } else if (next && linkPhase(next, readExpectedLink()) === "none" && readExpectedLink()) {
      // The studio has been up since the link was last seen and no longer knows it: it ended.
      writeExpectedLink(null);
      setExpected(null);
    }
  }, []);

  // Check in every 10s (this is the tab's heartbeat), every 2s while the dialog waits for the agent.
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), open && pairing ? 2000 : 10000);
    return () => window.clearInterval(t);
  }, [refresh, open, pairing]);

  // A pairing is done once the new agent checks in.
  useEffect(() => {
    if (!pairing || !status?.connected || !status.online) return;
    if (status.lastSeen && Date.parse(status.lastSeen) < pairing.startedAt - 1000) return;
    setPairing(null);
  }, [pairing, status]);

  // Starts a pairing for the chosen way and records when it began so older check-ins do not clear it.
  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent-link/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, mode: way }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      writeOwnerKey(body.ownerKey);
      setPairing({ way, agent, startedAt: Date.now(), expiresAt: body.expiresAt, command: body.command, addCommand: body.addCommand, addHint: body.addHint, prompt: body.prompt });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Ends the link: tells the studio, then swaps this browser's owner key so the old tokens stay dead even across a restart.
  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch("/api/agent-link", { method: "DELETE" }).catch(() => undefined);
      rotateOwnerKey();
      writeExpectedLink(null);
      setExpected(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const phase = linkPhase(status, expected);
  const label =
    phase === "online"
      ? `${status?.agentLabel} · ${status?.machine}`
      : phase === "offline"
        ? `${status?.agentLabel} offline`
        : phase === "reconnecting"
          ? `${expected?.agentLabel ?? "Agent"} reconnecting`
          : "Connect agent";
  const linked = phase !== "none";
  const agentLabel = AGENTS.find((a) => a.id === agent)?.label;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={phase === "online" ? `Connected to ${status?.agentLabel} on ${status?.machine}, checked in ${ago(status?.lastSeen)}` : "Connect your coding agent"}
      >
        <Badge tone={phase === "online" ? "success" : linked ? "warn" : "neutral"} icon={<Bot className="h-3 w-3" />} className="cursor-pointer">
          <span className="max-w-[180px] truncate">{label}</span>
        </Badge>
      </button>

      <Modal
        isOpen={open}
        onClose={() => {
          setOpen(false);
          setPairing(null);
        }}
        title="Connect your coding agent"
        subtitle="Your own agent does the studio's design and edit work, on your own subscription."
        icon={<Bot className="h-4 w-4" />}
        width="max-w-xl"
      >
        <div className="flex flex-col gap-3 font-sans text-[13px] text-ink">
          {linked && !pairing ? (
            <>
              <Note tone={phase === "online" ? "success" : "warn"}>
                {phase === "online" ? (
                  <>
                    Connected to <b>{status?.agentLabel}</b> on <b>{status?.machine}</b>, checked in {ago(status?.lastSeen)}.
                    {status?.busy ? " Working on a task." : ""}
                    {status?.pending ? ` ${status.pending} task(s) waiting.` : ""}
                  </>
                ) : phase === "reconnecting" ? (
                  <>
                    The studio restarted. <b>{expected?.agentLabel}</b> reconnects by itself, usually within a minute; nothing to do.
                  </>
                ) : (
                  <>
                    <b>{status?.agentLabel}</b> has not checked in for a while (last seen {ago(status?.lastSeen)}). It stays linked and picks up again as soon as it is running.
                  </>
                )}
              </Note>
              <p className="text-[11px] leading-snug text-ink-mute">The link stays on until you disconnect here or close the studio tab. A reload or a short network drop does not end it.</p>
              {status?.activity?.length ? (
                <div className="border-2 border-ink bg-paper-3 p-2 font-mono text-[11px]">
                  <div className="font-bold">What the agent is doing</div>
                  <ul className="mt-1 flex flex-col gap-0.5 text-ink-soft">
                    {status.activity.map((a) => (
                      <li key={a.seq}>
                        {new Date(a.at).toLocaleTimeString()} {a.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {status?.lastResult ? (
                <div className="border-2 border-ink bg-paper-3 p-2 font-mono text-[11px]">
                  <div className="font-bold">
                    Last task {status.lastResult.ok ? "finished" : "failed"} {ago(status.lastResult.at)}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap text-ink-soft">{status.lastResult.summary}</pre>
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void disconnect()} disabled={busy}>
                  <Unplug className="h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-soft">Agent</div>
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Agent">
                  {AGENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={agent === a.id}
                      onClick={() => {
                        setAgent(a.id);
                        setPairing(null);
                      }}
                      className={`border-2 border-ink px-2.5 py-2 text-left transition-colors ${agent === a.id ? "bg-select text-select-ink shadow-nb-sm" : "bg-paper-3 hover:bg-paper"}`}
                    >
                      <div className="text-[13px] font-bold">{a.label}</div>
                      <div className="font-mono text-[10px] opacity-80">{a.runs}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="How to link">
                {(
                  [
                    { id: "agent", title: "Use my running agent", note: "Recommended. You see every step in its own window." },
                    { id: "connector", title: "Download a connector", note: "A small script that runs tasks headless in a terminal." },
                  ] as Array<{ id: Way; title: string; note: string }>
                ).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="radio"
                    aria-checked={way === w.id}
                    onClick={() => {
                      setWay(w.id);
                      setPairing(null);
                    }}
                    className={`border-2 border-ink px-2.5 py-2 text-left transition-colors ${way === w.id ? "bg-select text-select-ink shadow-nb-sm" : "bg-paper-3 hover:bg-paper"}`}
                  >
                    <div className="text-[13px] font-bold">{w.title}</div>
                    <div className="text-[11px] opacity-80">{w.note}</div>
                  </button>
                ))}
              </div>

              {pairing?.way === "agent" ? (
                <div className="flex flex-col gap-2">
                  <div>
                    <b>1.</b> {pairing.addHint} This link is private to this browser.
                  </div>
                  <CopyBlock text={pairing.addCommand ?? ""} label="command" />
                  <div>
                    <b>2.</b> In {agentLabel}, paste this line. It keeps waiting for studio tasks and shows its work as it goes.
                  </div>
                  <CopyBlock text={pairing.prompt ?? ""} label="prompt" />
                </div>
              ) : pairing?.way === "connector" ? (
                <div className="flex flex-col gap-2">
                  <div>
                    Run this in the terminal where {agentLabel} is installed. The link works once, until {pairing.expiresAt ? new Date(pairing.expiresAt).toLocaleTimeString() : "it expires"}.
                    The connector shows each task and tool call as it happens and reconnects by itself.
                  </div>
                  <CopyBlock text={pairing.command ?? ""} label="command" />
                </div>
              ) : (
                <Button tone="primary" size="sm" onClick={() => void pair()} disabled={busy}>
                  {busy ? "Getting a link..." : way === "agent" ? "Get the link command" : "Get the connector command"}
                </Button>
              )}
              {pairing ? (
                <div className="flex items-center gap-2 font-mono text-[11px] text-ink-soft">
                  <Spinner /> {pairing.way === "agent" ? "Waiting for your agent to call the studio..." : "Waiting for your terminal..."}
                </div>
              ) : null}
              {error ? <Note tone="danger">{error}</Note> : null}
              <p className="text-[11px] leading-snug text-ink-mute">
                The agent works only through the aideos tools for these tasks, and only this browser can send it work. Once linked it stays linked until you disconnect or close the studio tab.
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
