/**
 * File Description: Live Agent Activity & Telemetry Trace Inspector Component (Phase 3).
 * Subscribes to real-time Server-Sent Events (/api/agent/trace) to display a unified
 * timeline of connected coding agent actions, neural TTS synthesis, AI video editing,
 * GPU B-roll rendering, and 19-rule geometric invariant validation.
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  Bot,
  Check,
  X,
  Loader2,
  AlertTriangle,
  Clock,
  Sparkles,
  Trash2,
  Activity,
  Terminal,
  Layers,
  Volume2,
  Film,
  ShieldCheck,
} from "lucide-react";

export interface AgentTraceStep {
  id: string;
  phase: string;
  title: string;
  description: string;
  timestamp: string;
  status: "pending" | "running" | "done" | "corrected" | "failed";
  details?: string[];
  source?: string;
  filmId?: string;
  durationMs?: number;
  createdAt?: string;
  error?: string;
}

export type ConnectionState = "connected" | "connecting" | "disconnected";

export interface AgentActivityInspectorProps {
  filmId?: string;
}

/** Returns a representative icon for a trace step phase or source. */
function getPhaseIcon(phase: string, source?: string) {
  if (source === "agent") return <Bot size={11} className="shrink-0" />;
  switch (phase) {
    case "grounding":
      return <Terminal size={11} className="shrink-0" />;
    case "synthesis":
      return <Volume2 size={11} className="shrink-0" />;
    case "broll":
      return <Film size={11} className="shrink-0" />;
    case "validation":
      return <ShieldCheck size={11} className="shrink-0" />;
    case "ai_edit":
      return <Sparkles size={11} className="shrink-0" />;
    case "dispatch":
      return <Layers size={11} className="shrink-0" />;
    default:
      return <Activity size={11} className="shrink-0" />;
  }
}

/** Formats duration in milliseconds into a concise seconds string. */
function formatDuration(ms?: number): string | null {
  if (typeof ms !== "number" || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const AgentActivityInspector: React.FC<AgentActivityInspectorProps> = ({ filmId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [steps, setSteps] = useState<AgentTraceStep[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  // Subscribe to live Server-Sent Events from the Aideos backend trace bus
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: any = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      setConnectionState("connecting");

      const url = filmId
        ? `/api/agent/trace?filmId=${encodeURIComponent(filmId)}`
        : "/api/agent/trace";

      try {
        const es = new EventSource(url);
        eventSource = es;

        es.addEventListener("open", () => {
          if (!isMounted) return;
          setConnectionState("connected");
        });

        es.addEventListener("connected", () => {
          if (!isMounted) return;
          setConnectionState("connected");
        });

        es.addEventListener("step", (event) => {
          if (!isMounted) return;
          try {
            const step: AgentTraceStep = JSON.parse(event.data);
            setSteps((prev) => {
              const existingIdx = prev.findIndex((s) => s.id === step.id);
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = step;
                return updated;
              }
              // Insert newest step at the beginning
              return [step, ...prev];
            });
          } catch (err) {
            console.error("[AgentActivityInspector] Failed to parse SSE step:", err);
          }
        });

        es.onerror = () => {
          if (!isMounted) return;
          setConnectionState("disconnected");
          es.close();
          reconnectTimer = setTimeout(connect, 3000);
        };
      } catch {
        setConnectionState("disconnected");
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (eventSource) eventSource.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [filmId]);

  /** Clears the local trace step history. */
  const handleClear = async () => {
    setSteps([]);
    try {
      await fetch("/api/agent/trace", { method: "DELETE" });
    } catch {
      // Ignored
    }
  };

  const hasRunningStep = useMemo(() => steps.some((s) => s.status === "running"), [steps]);

  const filteredSteps = useMemo(() => {
    if (activeFilter === "all") return steps;
    if (activeFilter === "agent") return steps.filter((s) => s.source === "agent");
    if (activeFilter === "pipeline") return steps.filter((s) => s.source !== "agent");
    if (activeFilter === "ai_edit") return steps.filter((s) => s.phase === "ai_edit");
    return steps.filter((s) => s.phase === activeFilter);
  }, [steps, activeFilter]);

  return (
    <div className="relative">
      {/* Trigger Button in Top Studio Bar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-[11px] font-mono px-2.5 py-1 bg-paper-3 hover:bg-sunken border-2 border-ink text-ink font-bold flex items-center gap-1.5 shadow transition-all shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
        title="Open Unified Live Agent Trace & Telemetry Timeline"
      >
        <span
          className={`w-2 h-2 rounded-full ${
            connectionState === "connected"
              ? hasRunningStep
                ? "bg-info animate-pulse"
                : "bg-success"
              : connectionState === "connecting"
              ? "bg-warn animate-pulse"
              : "bg-danger"
          }`}
        />
        <Bot size={12} />
        <span>Agent Trace</span>
        {steps.length > 0 && (
          <span className="ml-0.5 px-1 py-0.2 bg-sunken text-ink text-[9px] border border-ink font-bold">
            {steps.length}
          </span>
        )}
      </button>

      {/* Slide-Down Inspector Panel */}
      {isOpen && (
        <div className="absolute right-0 top-9 w-[460px] max-h-[580px] bg-paper-3 border-2 border-ink shadow-nb z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Panel Header */}
          <div className="p-3 bg-paper-2 border-b-2 border-ink flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Bot size={14} className="text-ink" />
              <span className="text-xs font-bold text-ink">AGENT TRACE</span>
              <span
                className={`text-[9px] font-mono border-2 border-ink px-1.5 py-0.5 font-bold flex items-center gap-1 shadow-nb-xs ${
                  connectionState === "connected"
                    ? "bg-success/25 text-ink"
                    : connectionState === "connecting"
                    ? "bg-warn/25 text-ink animate-pulse"
                    : "bg-danger/25 text-ink"
                }`}
              >
                {connectionState === "connected" ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                    LIVE
                  </>
                ) : connectionState === "connecting" ? (
                  <>
                    <Loader2 size={9} className="animate-spin" />
                    CONNECTING
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block" />
                    OFFLINE
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {steps.length > 0 && (
                <button
                  onClick={handleClear}
                  className="text-ink-soft hover:text-ink hover:bg-sunken text-[10px] font-mono px-1.5 py-0.5 border border-ink/40 flex items-center gap-1 shadow-nb-xs"
                  title="Clear trace history"
                >
                  <Trash2 size={10} />
                  <span>Clear</span>
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-ink-soft hover:text-ink text-xs p-1"
                title="Close trace panel"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="px-3 py-1.5 bg-sunken border-b-2 border-ink flex items-center gap-1 text-[10px] font-mono overflow-x-auto shrink-0">
            <span className="text-ink-soft mr-1">Filter:</span>
            {[
              { key: "all", label: "All" },
              { key: "agent", label: "Agent" },
              { key: "pipeline", label: "Pipeline" },
              { key: "ai_edit", label: "AI Edit" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={`px-2 py-0.5 border text-[10px] transition-colors ${
                  activeFilter === tab.key
                    ? "bg-primary border-ink font-bold text-ink shadow-nb-xs"
                    : "bg-paper-3 border-ink/40 text-ink-soft hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Steps Timeline Feed */}
          <div className="p-3.5 flex flex-col gap-3 overflow-y-auto font-mono text-xs max-h-[460px]">
            {filteredSteps.length === 0 ? (
              /* Honest Empty State */
              <div className="p-6 bg-paper-2 border-2 border-ink text-center flex flex-col items-center justify-center gap-2.5 shadow-nb-sm my-2">
                <div className="p-2.5 bg-sunken border-2 border-ink rounded-full text-ink">
                  <Activity size={20} />
                </div>
                <div className="font-bold text-ink text-xs">No Activity Recorded Yet</div>
                <p className="text-[11px] text-ink-soft font-sans max-w-[320px] leading-relaxed">
                  Real-time trace telemetry from the connected coding agent, neural voiceover, AI video edits, and invariant checks will appear here automatically.
                </p>
                <div className="text-[10px] font-mono text-ink bg-sunken border border-ink px-2 py-1 shadow-nb-xs">
                  Listening on /api/agent/trace
                </div>
              </div>
            ) : (
              filteredSteps.map((step) => {
                const duration = formatDuration(step.durationMs);
                return (
                  <div
                    key={step.id}
                    className={`bg-paper-3 border-2 border-ink p-2.5 flex flex-col gap-1.5 shadow-nb-sm transition-all ${
                      step.status === "running" ? "border-info shadow-nb" : ""
                    }`}
                  >
                    {/* Header line: Phase + Source + Status */}
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-mono font-bold bg-sunken border border-ink px-1.5 py-0.5 text-ink flex items-center gap-1 shadow-nb-xs">
                          {getPhaseIcon(step.phase, step.source)}
                          {step.source === "agent" ? "AGENT" : step.phase.toUpperCase()}
                        </span>
                        <span className="font-bold text-ink text-[11px] truncate max-w-[240px]">
                          {step.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {step.status === "done" && (
                          <span className="text-[9px] text-ink bg-success/25 border-2 border-ink px-1.5 py-0.5 font-bold flex items-center gap-1 shadow-nb-xs">
                            <Check size={9} /> DONE
                          </span>
                        )}
                        {step.status === "running" && (
                          <span className="text-[9px] text-ink bg-info/25 border-2 border-ink px-1.5 py-0.5 font-bold flex items-center gap-1 shadow-nb-xs animate-pulse">
                            <Loader2 size={9} className="animate-spin" /> RUNNING
                          </span>
                        )}
                        {step.status === "corrected" && (
                          <span className="text-[9px] text-ink bg-select/25 border-2 border-ink px-1.5 py-0.5 font-bold flex items-center gap-1 shadow-nb-xs">
                            <Sparkles size={9} /> REPAIRED
                          </span>
                        )}
                        {step.status === "failed" && (
                          <span className="text-[9px] text-ink bg-danger/25 border-2 border-ink px-1.5 py-0.5 font-bold flex items-center gap-1 shadow-nb-xs">
                            <AlertTriangle size={9} /> FAILED
                          </span>
                        )}
                        {step.status === "pending" && (
                          <span className="text-[9px] text-ink bg-warn/25 border-2 border-ink px-1.5 py-0.5 font-bold flex items-center gap-1 shadow-nb-xs">
                            <Clock size={9} /> QUEUED
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Step Description */}
                    {step.description && (
                      <p className="text-[10px] text-ink font-sans leading-relaxed">
                        {step.description}
                      </p>
                    )}

                    {/* Technical details or code calls */}
                    {step.details && step.details.length > 0 && (
                      <div className="bg-sunken p-2 text-[9px] text-ink-soft font-mono flex flex-col gap-1 border-2 border-ink shadow-nb-xs">
                        {step.details.map((d, i) => (
                          <div key={i} className="text-ink break-all">
                            {d}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Error message display */}
                    {step.error && (
                      <div className="bg-danger/10 border border-danger/40 p-1.5 text-[9px] text-danger-text font-mono">
                        {step.error}
                      </div>
                    )}

                    {/* Timestamp & Duration Footer */}
                    <div className="flex items-center justify-between text-[9px] text-ink-soft pt-0.5 border-t border-ink/20">
                      <span>{step.filmId ? `film: ${step.filmId}` : ""}</span>
                      <div className="flex items-center gap-2">
                        {duration && <span>{duration}</span>}
                        <span>{step.timestamp}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
