/**
 * File Description: The header's agent badge and the Connect your coding agent dialog.
 * The badge always tells the truth about who does the studio's agent work: the agent and machine
 * connected through `aideos connect` and when it last checked in, or that none is connected. The
 * dialog pairs one: pick the agent, get a one-time code, run the shown command in that agent's
 * terminal, and the badge turns green when the connector checks in.
 */

import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, Unplug } from "lucide-react";
import { Badge, Button, Modal, Note, Spinner } from "./ui";
import { readOwnerKey, writeOwnerKey } from "../state/agentLink";

type Agent = "claude" | "agy" | "codex" | "opencode";

const AGENTS: Array<{ id: Agent; label: string; runs: string }> = [
  { id: "claude", label: "Claude Code", runs: "claude -p" },
  { id: "agy", label: "Antigravity", runs: "agy -p --sandbox" },
  { id: "codex", label: "Codex", runs: "codex exec" },
  { id: "opencode", label: "OpenCode", runs: "opencode run" },
];

interface LinkStatus {
  connected: boolean;
  online: boolean;
  agentLabel?: string;
  machine?: string;
  lastSeen?: string;
  pending: number;
  lastResult?: { taskId: string; ok: boolean; summary: string; at: string };
}

interface Pairing {
  code: string;
  expiresAt: string;
  command: string;
}

// Formats how long ago an ISO time was.
function ago(iso?: string): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Reads the owner's connection status from the studio.
async function fetchStatus(): Promise<LinkStatus | null> {
  if (!readOwnerKey()) return { connected: false, online: false, pending: 0 };
  try {
    const res = await fetch("/api/agent-link/status");
    return res.ok ? ((await res.json()) as LinkStatus) : null;
  } catch {
    return null;
  }
}

/** Header badge plus the pairing dialog. */
export function AgentConnect() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<Agent>("claude");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setStatus(await fetchStatus()), []);

  // Check in every 10s, every 2s while the dialog waits for the connector.
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), open && pairing ? 2000 : 10000);
    return () => window.clearInterval(t);
  }, [refresh, open, pairing]);

  // A pairing is done once the connector checks in.
  useEffect(() => {
    if (pairing && status?.connected && status.online) setPairing(null);
  }, [pairing, status]);

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent-link/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      writeOwnerKey(body.ownerKey);
      setPairing({ code: body.code, expiresAt: body.expiresAt, command: body.command });
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch("/api/agent-link", { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const online = Boolean(status?.connected && status.online);
  const label = online
    ? `${status?.agentLabel} · ${status?.machine}`
    : status?.connected
      ? `${status.agentLabel} offline`
      : "Connect agent";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={online ? `Connected to ${status?.agentLabel} on ${status?.machine}, checked in ${ago(status?.lastSeen)}` : "Connect your coding agent"}>
        <Badge tone={online ? "success" : status?.connected ? "warn" : "neutral"} icon={<Bot className="h-3 w-3" />} className="cursor-pointer">
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
          {online && !pairing ? (
            <>
              <Note tone="success">
                Connected to <b>{status?.agentLabel}</b> on <b>{status?.machine}</b>, checked in {ago(status?.lastSeen)}.
                {status?.pending ? ` ${status.pending} task(s) waiting.` : ""}
              </Note>
              {status?.lastResult ? (
                <div className="border-2 border-ink bg-paper-3 p-2 font-mono text-[11px]">
                  <div className="font-bold">
                    Last task {status.lastResult.ok ? "finished" : "failed"} {ago(status.lastResult.at)}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap text-ink-soft">{status.lastResult.summary}</pre>
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void pair()} disabled={busy}>
                  Pair a different agent
                </Button>
                <Button size="sm" tone="danger" onClick={() => void disconnect()} disabled={busy}>
                  <Unplug className="h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              {status?.connected && !status.online && !pairing ? (
                <Note tone="warn">
                  {status.agentLabel} on {status.machine} has not checked in since {ago(status.lastSeen)}. Start the connector again in that terminal, or pair a new one.
                </Note>
              ) : null}
              {status?.connected && pairing ? (
                <Note tone="warn">
                  Claiming this code replaces {status.agentLabel} on {status.machine}: that terminal&apos;s connector will stop on its next check-in.
                </Note>
              ) : null}
              <div>
                <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-soft">Agent</div>
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

              {pairing ? (
                <div className="flex flex-col gap-2">
                  <div>
                    Run this in the terminal where {AGENTS.find((a) => a.id === agent)?.label} is installed. The code <b className="font-mono">{pairing.code}</b> works once, until{" "}
                    {new Date(pairing.expiresAt).toLocaleTimeString()}.
                  </div>
                  <div className="flex items-stretch gap-1.5">
                    <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap border-2 border-ink bg-sunken px-2.5 py-2 font-mono text-[11px] text-ink">{pairing.command}</code>
                    <Button size="sm" iconOnly onClick={() => void copy()} title="Copy command" aria-label="Copy command">
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-ink-soft">
                    <Spinner /> Waiting for your terminal...
                  </div>
                </div>
              ) : (
                <Button tone="primary" size="sm" onClick={() => void pair()} disabled={busy}>
                  {busy ? "Getting a code..." : "Get a pairing code"}
                </Button>
              )}
              {error ? <Note tone="danger">{error}</Note> : null}
              <p className="text-[11px] leading-snug text-ink-mute">
                The agent never gets a shell or your files for these tasks: it runs in an empty scratch folder and works only through the aideos tools. Only this browser can send it work.
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
