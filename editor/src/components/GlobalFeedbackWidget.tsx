/**
 * File Description: Global AI assistant for Aideos Studio.
 * A dockable panel available from every stage that takes plain-language feedback ("shorten shot 2",
 * "switch to the blueprint theme"), runs it through the critique engine, and applies the result as
 * one undoable project edit. Conversation history is kept per project so the assistant remembers
 * what was already asked for on this film.
 */

import { useState, useRef, useEffect } from "react";
import { X, Send, Bot, Sparkles, Trash2 } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { Badge, Button, Card, Input, Spinner, cn } from "./ui";

/** Ready-made requests that show what the assistant can actually do. */
const QUICK_PROMPTS = [
  "Shorten shot 2 by one second",
  "Switch the theme to blueprint",
  "Make the scale bar density 0.75",
  "Set the actor facing direction to left",
];

interface FeedbackMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: string;
  context?: string;
}

interface GlobalFeedbackWidgetProps {
  film: Film;
  activeMode: string;
  activeSelectionId?: string;
  onUpdateFilm?: (updated: Film) => void;
}

// Renders the global floating feedback chatbot widget present across all editor views.
export function GlobalFeedbackWidget({
  film,
  activeMode,
  activeSelectionId,
  onUpdateFilm,
}: GlobalFeedbackWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const storageKey = `aideos_feedback_history_${film.id}`;

  // Creates the default initial greeting message for a film project.
  const createDefaultWelcome = (f: Film): FeedbackMessage => ({
    id: `welcome-${f.id}`,
    sender: "assistant",
    text: `Ahoy! I am your Aideos AI Video Assistant. Submit your feedback on "${f.title}" or ask for script, audio, timing, and animation adjustments!`,
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });

  const [messages, setMessages] = useState<FeedbackMessage[]>(() => {
    const saved = localStorage.getItem(`aideos_feedback_history_${film.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // Fall back to the default welcome message.
      }
    }
    return [createDefaultWelcome(film)];
  });
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scrolls message container to bottom whenever new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Re-sync chat messages whenever active film id changes
  useEffect(() => {
    const saved = localStorage.getItem(`aideos_feedback_history_${film.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch {
        // Fall back to the default welcome message.
      }
    }
    setMessages([createDefaultWelcome(film)]);
  }, [film]);

  // Persists message history to local storage whenever messages update
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages));
    scrollToBottom();
  }, [messages, storageKey]);

  // Handles sending user feedback and executing AI critique engine updates
  const handleSendMessage = async (textToSend?: string) => {
    const messageContent = (textToSend || inputText).trim();
    if (!messageContent) return;

    const timeStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const currentContext = `Mode: ${activeMode}${activeSelectionId ? ` | Selected: ${activeSelectionId}` : ""}`;

    const userMsg: FeedbackMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: messageContent,
      timestamp: timeStr,
      context: currentContext,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/critique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ critique: messageContent, film }),
      });
      const data = await res.json();
      if (data.ok && data.updatedFilm && onUpdateFilm) {
        onUpdateFilm(data.updatedFilm);
      }

      const assistantMsg: FeedbackMessage = {
        id: `assistant-${Date.now()}`,
        sender: "assistant",
        text:
          data.explanation ||
          (data.ok
            ? "Captain, adjustments have been applied to the composition!"
            : data.error || "Unable to apply adjustment."),
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const assistantMsg: FeedbackMessage = {
        id: `assistant-${Date.now()}`,
        sender: "assistant",
        text: `Error applying critique: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  // Quick feedback chip trigger handler
  const handleChipClick = (chipText: string) => {
    handleSendMessage(chipText);
  };

  // Clears chat feedback history back to initial state
  const handleClearHistory = () => {
    const defaultMsg: FeedbackMessage = {
      id: `welcome-${Date.now()}`,
      sender: "assistant",
      text: `Chat reset. Share feedback on "${film.title}" anytime!`,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setMessages([defaultMsg]);
    localStorage.removeItem(storageKey);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[95] font-sans">
      {isOpen ? (
        <div className="mb-2 flex h-[min(560px,70vh)] w-[min(380px,92vw)] flex-col border-3 border-ink bg-paper-2 shadow-nb-xl">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-ink bg-primary px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="h-4 w-4 shrink-0 text-ink" />
              <span className="truncate font-sans text-[12px] font-extrabold uppercase tracking-[0.06em] text-ink">
                AI assistant
              </span>
              <Badge tone="neutral" title="What the assistant can see right now">
                {activeMode}
              </Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="xs" iconOnly onClick={handleClearHistory} title="Clear this conversation">
                <Trash2 className="h-3 w-3" />
              </Button>
              <Button size="xs" iconOnly onClick={() => setIsOpen(false)} title="Close the assistant">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-sunken p-2">
            <ul className="flex flex-col gap-2">
              {messages.map((msg) => (
                <li
                  key={msg.id}
                  className={cn("flex", msg.sender === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[86%] border-2 border-ink px-2.5 py-1.5 shadow-nb-xs",
                      msg.sender === "user" ? "bg-select text-select-ink" : "bg-paper-3 text-ink",
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed">
                      {msg.text}
                    </p>
                    <p
                      className={cn(
                        "mt-1 font-mono text-[9px] tabular-nums",
                        msg.sender === "user" ? "text-ink/75" : "text-ink-mute",
                      )}
                    >
                      {msg.timestamp}
                      {msg.context ? ` \u00b7 ${msg.context}` : ""}
                    </p>
                  </div>
                </li>
              ))}
              {isTyping ? (
                <li className="flex justify-start">
                  <div className="border-2 border-ink bg-paper-3 px-2.5 py-1.5 text-ink shadow-nb-xs">
                    <Spinner label="Thinking" />
                  </div>
                </li>
              ) : null}
            </ul>
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t-2 border-ink bg-paper p-2">
            <div className="mb-2 flex flex-wrap gap-1">
              {QUICK_PROMPTS.map((prompt) => (
                <Card
                  key={prompt}
                  interactive
                  onClick={() => handleChipClick(prompt)}
                  className="px-1.5 py-0.5 font-sans text-[10px] font-bold"
                >
                  {prompt}
                </Card>
              ))}
            </div>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendMessage();
              }}
            >
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask for a change to this film"
                aria-label="Message the AI assistant"
                className="h-8 py-0"
              />
              <Button type="submit" size="sm" tone="primary" iconOnly disabled={isTyping || !inputText.trim()}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {/* Collapsed, the trigger is a single square so it covers as little of the inspector as
          possible; the label only appears while the panel is open. */}
      <div className="flex justify-end">
        <Button
          size="md"
          iconOnly={!isOpen}
          tone={isOpen ? "default" : "select"}
          onClick={() => setIsOpen(!isOpen)}
          className="shadow-nb"
          aria-label={isOpen ? "Close the AI assistant" : "Open the AI assistant"}
          title={isOpen ? "Close the AI assistant" : "Open the AI assistant"}
        >
          {isOpen ? <X className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {isOpen ? <span>Close</span> : null}
        </Button>
      </div>
    </div>
  );
}
