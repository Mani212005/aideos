/**
 * File Description: The Agent sheet. One header button shows who does the agent work (online, working, offline, none) and opens one sheet that links an agent (your running agent, or a connector), shows its live work and the last task, and unlinks it. It replaces the Connect agent dialog and the Agent trace panel. Polling the link status is this browser's heartbeat: the link ends when the studio tab stops asking, or on Disconnect, so the polling runs while the sheet is closed.
 * Inputs and outputs: the link status and the trace stream from the dev server -> a header button and a side sheet; pairing and disconnect are posted to /api/agent-link.
 * Used by: editor/src/App.tsx.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Trash2, Unplug, X } from "lucide-react";
import { Button, Note, Spinner, cn } from "../ui";
import { linkPhase, readExpectedLink, readOwnerKey, rotateOwnerKey, writeExpectedLink, writeOwnerKey } from "../../state/agentLink";

type Agent = "claude" | "agy" | "codex" | "opencode";
type Way = "agent" | "connector";

const AGENTS: Array<{ id: Agent; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "agy", label: "Antigravity" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
];

const WAYS: Array<{ id: Way; label: string }> = [
  { id: "agent", label: "My agent" },
  { id: "connector", label: "Connector" },
];

interface LinkStatus {
  connected: boolean;
  online: boolean;
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
  command?: string;
  addCommand?: string;
  prompt?: string;
}

/** One step the agent or the pipeline reported on the trace stream. */
interface TraceStep {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "corrected" | "failed";
  source?: string;
  timestamp: string;
  error?: string;
}

const STEP_WORD: Record<TraceStep["status"], string> = {
  pending: "Queued",
  running: "Running",
  done: "Done",
  corrected: "Fixed",
  failed: "Failed",
};

// Formats how long ago an ISO time was.
function ago(iso?: string): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Reads the owner's link status from the studio (null when the studio is out of reach).
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
  // Copies the text to the clipboard and shows a check mark.
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
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-lg border border-line bg-sunken px-2.5 py-2 font-mono text-xs text-ink">{text}</code>
      <Button size="sm" iconOnly onClick={() => void copy()} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

// A radio row of choices.
function Choice<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: Array<{ id: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-sans text-xs font-semibold text-ink-soft">{label}</h3>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "h-9 rounded-lg border px-2.5 text-left font-sans text-xs font-semibold transition-colors",
            value === it.id ? "border-select bg-select text-select-ink" : "border-line bg-paper-3 text-ink hover:bg-sunken",
          )}
        >
          {it.label}
        </button>
      ))}
      </div>
    </div>
  );
}

// Reads the trace stream while `open` is true; the server replays the recent steps on connect.
function useTrace(open: boolean): { steps: TraceStep[]; clear: () => void } {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  useEffect(() => {
    if (!open) return;
    let es: EventSource | null = null;
    let timer: number | undefined;
    let live = true;
    // Opens the stream and reopens it after a drop.
    const connect = () => {
      if (!live) return;
      es = new EventSource("/api/agent/trace");
      es.addEventListener("step", (event) => {
        try {
          const step = JSON.parse((event as MessageEvent<string>).data) as TraceStep;
          setSteps((prev) => (prev.some((s) => s.id === step.id) ? prev.map((s) => (s.id === step.id ? step : s)) : [step, ...prev]).slice(0, 40));
        } catch {
          // A step that does not parse is skipped.
        }
      });
      es.onerror = () => {
        es?.close();
        timer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      live = false;
      es?.close();
      window.clearTimeout(timer);
    };
  }, [open]);
  // Clears the list here and on the server.
  const clear = useCallback(() => {
    setSteps([]);
    void fetch("/api/agent/trace", { method: "DELETE" }).catch(() => undefined);
  }, []);
  return { steps, clear };
}

/** The header button and the Agent sheet. */
export function AgentSheet() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<Agent>("claude");
  const [way, setWay] = useState<Way>("agent");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expected, setExpected] = useState(readExpectedLink());
  const sheetRef = useRef<HTMLElement>(null);
  const trace = useTrace(open);

  // Reads the link status and keeps the expected link in step with it.
  const refresh = useCallback(async () => {
    const next = await fetchStatus();
    setStatus(next);
    if (next?.connected && next.online) {
      const link = { agentLabel: next.agentLabel ?? "agent", machine: next.machine ?? "", lastOnline: Date.now() };
      writeExpectedLink(link);
      setExpected(link);
    } else if (next && linkPhase(next, readExpectedLink()) === "none" && readExpectedLink()) {
      writeExpectedLink(null);
      setExpected(null);
    }
  }, []);

  // Check in every 10 s (the tab heartbeat), every 2 s while the sheet waits for a new agent.
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

  // Close on Escape and put the focus in the sheet when it opens.
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus();
    // Closes the sheet on Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Asks the studio for a link command for the chosen agent and way.
  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent-link/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, mode: way }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      writeOwnerKey(body.ownerKey);
      setPairing({ way, agent, startedAt: Date.now(), command: body.command, addCommand: body.addCommand, prompt: body.prompt });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Ends the link and swaps this browser's owner key so the old tokens stay dead, even across a restart.
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
  const working = phase === "online" && Boolean(status?.busy);
  const agentName = AGENTS.find((a) => a.id === agent)?.label ?? "agent";
  const phaseWord = working ? "Working" : phase === "online" ? "Online" : phase === "offline" ? "Offline" : phase === "reconnecting" ? "Reconnecting" : "None";
  const dot = phase === "online" ? (working ? "bg-info animate-pulse" : "bg-success") : phase === "none" ? "bg-ink-mute" : "bg-warn";

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} title={`Agent: ${phaseWord}`} aria-label="Agent" aria-expanded={open}>
        <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
        <span>Agent</span>
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end" data-testid="agent-sheet">
          <button type="button" aria-label="Close" tabIndex={-1} onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-ink/20" />
          <aside ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Agent" className="relative flex h-full outline-none w-full max-w-[420px] flex-col border-l border-line bg-paper-2 text-ink">
            <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4" aria-hidden />
                <h2 className="font-sans text-sm font-semibold">Agent</h2>
                <span className="flex items-center gap-1.5 font-mono text-xs text-ink-soft">
                  <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
                  {phaseWord}
                </span>
              </div>
              <Button tone="ghost" size="sm" iconOnly onClick={() => setOpen(false)} title="Close" aria-label="Close sheet">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
              {phase !== "none" && !pairing ? (
                <section className="flex flex-col gap-2">
                  <p className="font-mono text-xs text-ink">
                    {status?.agentLabel ?? expected?.agentLabel ?? "Agent"} {status?.machine ?? expected?.machine ?? ""}
                  </p>
                  <p className="font-sans text-xs text-ink-soft">
                    {phase === "online" ? `Seen ${ago(status?.lastSeen)}.` : phase === "reconnecting" ? "Studio restarted. The agent returns by itself." : `Last seen ${ago(status?.lastSeen)}.`}
                    {status?.pending ? ` ${status.pending} waiting.` : ""}
                  </p>
                  <div>
                    <Button size="sm" onClick={() => void disconnect()} disabled={busy}>
                      <Unplug className="h-3.5 w-3.5" /> Disconnect
                    </Button>
                  </div>
                </section>
              ) : (
                <section className="flex flex-col gap-3">
                  <Choice label="Agent" value={agent} items={AGENTS} onChange={(v) => { setAgent(v); setPairing(null); }} />
                  <Choice label="Link with" value={way} items={WAYS} onChange={(v) => { setWay(v); setPairing(null); }} />
                  {pairing?.way === "agent" ? (
                    <div className="flex flex-col gap-2 font-sans text-xs">
                      <p>1. Run this.</p>
                      <CopyBlock text={pairing.addCommand ?? ""} label="command" />
                      <p>2. Paste this in {agentName}.</p>
                      <CopyBlock text={pairing.prompt ?? ""} label="prompt" />
                    </div>
                  ) : pairing?.way === "connector" ? (
                    <div className="flex flex-col gap-2 font-sans text-xs">
                      <p>Run this in a terminal. It works once.</p>
                      <CopyBlock text={pairing.command ?? ""} label="command" />
                    </div>
                  ) : (
                    <div>
                      <Button tone="primary" size="sm" onClick={() => void pair()} disabled={busy}>
                        {busy ? <Spinner /> : null}
                        Link
                      </Button>
                    </div>
                  )}
                  {pairing ? (
                    <p className="flex items-center gap-2 font-mono text-xs text-ink-soft">
                      <Spinner /> Waiting
                    </p>
                  ) : null}
                  {error ? <Note tone="danger">{error}</Note> : null}
                </section>
              )}

              {status?.lastResult ? (
                <section className="flex flex-col gap-1">
                  <h3 className="font-sans text-xs font-semibold text-ink-soft">
                    Last task: {status.lastResult.ok ? "Done" : "Failed"} {ago(status.lastResult.at)}
                  </h3>
                  <pre className="whitespace-pre-wrap rounded-lg border border-line bg-sunken p-2 font-mono text-xs text-ink">{status.lastResult.summary}</pre>
                </section>
              ) : null}

              <section className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-sans text-xs font-semibold text-ink-soft">Work</h3>
                  {trace.steps.length > 0 ? (
                    <Button tone="ghost" size="xs" onClick={trace.clear} title="Clear">
                      <Trash2 className="h-3 w-3" /> Clear
                    </Button>
                  ) : null}
                </div>
                {status?.activity?.slice(-5).map((a) => (
                  <p key={a.seq} className="font-mono text-xs text-ink-soft">
                    {new Date(a.at).toLocaleTimeString()} {a.text}
                  </p>
                ))}
                {trace.steps.length === 0 && !status?.activity?.length ? <p className="font-sans text-xs text-ink-soft">No work yet.</p> : null}
                <ul className="flex flex-col gap-1">
                  {trace.steps.map((step) => (
                    <li key={step.id} className="flex flex-col gap-0.5 rounded-lg border border-line bg-paper-3 px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-sans text-xs font-semibold">{step.title}</span>
                        <span className={cn("shrink-0 font-mono text-xs", step.status === "failed" ? "text-danger-text" : "text-ink-soft")}>{STEP_WORD[step.status]}</span>
                      </div>
                      {step.error ? <span className="font-mono text-xs text-danger-text">{step.error}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
