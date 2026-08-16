/*
File Description: This component implements a global floating chatbot and feedback drawer across all editor screens in Aideos, allowing users to submit video, script, and visual feedback or chat with the AI assistant.
*/

import { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send, Bot, Sparkles } from "lucide-react";
import type { Film } from "../../../src/dl/schema";

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
}

// Renders the global floating feedback chatbot widget present across all editor views.
export function GlobalFeedbackWidget({ film, activeMode, activeSelectionId }: GlobalFeedbackWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<FeedbackMessage[]>(() => {
    const saved = localStorage.getItem("aideos_feedback_history");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fall back to default initial welcome message
      }
    }
    return [
      {
        id: "welcome-1",
        sender: "assistant",
        text: `Ahoy! I am your Aideos AI Video Assistant. Submit your feedback on "${film.title}" or ask for script and animation adjustments!`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ];
  });
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scrolls message container to bottom whenever new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Persists message history to local storage whenever messages update
  useEffect(() => {
    localStorage.setItem("aideos_feedback_history", JSON.stringify(messages));
    scrollToBottom();
  }, [messages]);

  // Handles sending user feedback and simulating automated AI assistant response
  const handleSendMessage = (textToSend?: string) => {
    const messageContent = (textToSend || inputText).trim();
    if (!messageContent) return;

    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

    // Simulate AI response synthesis based on user feedback
    setTimeout(() => {
      let responseText = "Thank you for the feedback! Your notes have been captured into the video composition state.";

      const lower = messageContent.toLowerCase();
      if (lower.includes("script") || lower.includes("text") || lower.includes("narration")) {
        responseText = `Got it! Noted your script feedback for "${film.title}". You can refine the narration directly in the Script tab or use AI auto-rewrite.`;
      } else if (lower.includes("color") || lower.includes("style") || lower.includes("accent")) {
        responseText = `Visual style feedback received! Accent color is currently set to ${film.accent || "#635BFF"}. Check the Customization tab to tweak design tokens.`;
      } else if (lower.includes("timing") || lower.includes("speed") || lower.includes("transition")) {
        responseText = `Shot timing feedback recorded for ${activeMode} mode. The timeline editor supports sub-second frame seeking and spring physics adjustment.`;
      } else if (lower.includes("bug") || lower.includes("fix") || lower.includes("error")) {
        responseText = `Bug report logged! Diagnostic details captured for active mode (${activeMode}) and project "${film.id}".`;
      }

      const assistantMsg: FeedbackMessage = {
        id: `assistant-${Date.now()}`,
        sender: "assistant",
        text: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    }, 900);
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
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages([defaultMsg]);
    localStorage.removeItem("aideos_feedback_history");
  };

  return (
    <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999, fontFamily: "Geist, sans-serif" }}>
      {/* Expanded Feedback & Chatbot Panel */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "64px",
            right: "0",
            width: "390px",
            height: "540px",
            backgroundColor: "#101013",
            border: "1px solid rgba(99, 91, 255, 0.35)",
            borderRadius: "16px",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7), 0 0 20px rgba(99, 91, 255, 0.15)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Header Bar */}
          <div
            style={{
              padding: "14px 16px",
              backgroundColor: "rgba(10, 10, 11, 0.9)",
              borderBottom: "1px solid rgba(245, 245, 245, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  backgroundColor: "rgba(99, 91, 255, 0.2)",
                  border: "1px solid #635BFF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#635BFF",
                }}
              >
                <Bot size={18} />
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "#F5F5F5", display: "flex", alignItems: "center", gap: "6px" }}>
                  Aideos Assistant
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "2px 6px",
                      borderRadius: "10px",
                      backgroundColor: "rgba(99, 91, 255, 0.2)",
                      color: "#635BFF",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    AI FEEDBACK
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "#8A8A8E" }}>
                  Project: {film.title}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                onClick={handleClearHistory}
                title="Clear feedback history"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8A8A8E",
                  cursor: "pointer",
                  fontSize: "11px",
                  padding: "4px 8px",
                  borderRadius: "4px",
                }}
              >
                Reset
              </button>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8A8A8E",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Active Context Banner */}
          <div
            style={{
              padding: "6px 16px",
              backgroundColor: "rgba(99, 91, 255, 0.08)",
              borderBottom: "1px solid rgba(99, 91, 255, 0.15)",
              fontSize: "11px",
              fontFamily: "JetBrains Mono, monospace",
              color: "#8A8A8E",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>Active Screen: <strong style={{ color: "#F5F5F5" }}>{activeMode}</strong></span>
            <span>Shots: {film.shots?.length || 0}</span>
          </div>

          {/* Messages Stream */}
          <div
            style={{
              flex: 1,
              padding: "16px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: msg.sender === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "10px 14px",
                    borderRadius: msg.sender === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                    backgroundColor: msg.sender === "user" ? "#635BFF" : "rgba(245, 245, 245, 0.06)",
                    color: "#F5F5F5",
                    fontSize: "13px",
                    lineHeight: "1.45",
                    border: msg.sender === "user" ? "none" : "1px solid rgba(245, 245, 245, 0.1)",
                  }}
                >
                  {msg.text}
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: "#8A8A8E",
                    marginTop: "4px",
                    padding: "0 4px",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {msg.timestamp}
                </div>
              </div>
            ))}

            {isTyping && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#8A8A8E", fontSize: "12px", padding: "4px 8px" }}>
                <Sparkles size={14} className="animate-spin" style={{ color: "#635BFF" }} />
                AI Assistant is reflecting on feedback...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Feedback Chips */}
          <div
            style={{
              padding: "8px 12px",
              display: "flex",
              gap: "6px",
              overflowX: "auto",
              borderTop: "1px solid rgba(245, 245, 245, 0.06)",
              backgroundColor: "rgba(10, 10, 11, 0.5)",
            }}
          >
            <button
              onClick={() => handleChipClick("Suggest script narration polish")}
              style={{
                whiteSpace: "nowrap",
                fontSize: "11px",
                padding: "4px 10px",
                borderRadius: "12px",
                backgroundColor: "rgba(245, 245, 245, 0.08)",
                border: "1px solid rgba(245, 245, 245, 0.12)",
                color: "#F5F5F5",
                cursor: "pointer",
              }}
            >
              ✍️ Polish Script
            </button>
            <button
              onClick={() => handleChipClick("Adjust color palette and contrast")}
              style={{
                whiteSpace: "nowrap",
                fontSize: "11px",
                padding: "4px 10px",
                borderRadius: "12px",
                backgroundColor: "rgba(245, 245, 245, 0.08)",
                border: "1px solid rgba(245, 245, 245, 0.12)",
                color: "#F5F5F5",
                cursor: "pointer",
              }}
            >
              🎨 Color & Style
            </button>
            <button
              onClick={() => handleChipClick("Fix shot transition timing")}
              style={{
                whiteSpace: "nowrap",
                fontSize: "11px",
                padding: "4px 10px",
                borderRadius: "12px",
                backgroundColor: "rgba(245, 245, 245, 0.08)",
                border: "1px solid rgba(245, 245, 245, 0.12)",
                color: "#F5F5F5",
                cursor: "pointer",
              }}
            >
              ⏱️ Timing & Motion
            </button>
          </div>

          {/* Input Box Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{
              padding: "12px 14px",
              backgroundColor: "#0A0A0B",
              borderTop: "1px solid rgba(245, 245, 245, 0.1)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type feedback or request edit..."
              style={{
                flex: 1,
                backgroundColor: "#101013",
                border: "1px solid rgba(245, 245, 245, 0.15)",
                borderRadius: "10px",
                padding: "10px 12px",
                color: "#F5F5F5",
                fontSize: "13px",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              style={{
                backgroundColor: inputText.trim() ? "#635BFF" : "rgba(245, 245, 245, 0.1)",
                color: inputText.trim() ? "#FFFFFF" : "#8A8A8E",
                border: "none",
                borderRadius: "10px",
                width: "38px",
                height: "38px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: inputText.trim() ? "pointer" : "not-allowed",
                transition: "background 0.2s ease",
              }}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      {/* Floating Global Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "12px 18px",
          borderRadius: "30px",
          backgroundColor: "#101013",
          color: "#F5F5F5",
          border: "1px solid rgba(99, 91, 255, 0.5)",
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(99, 91, 255, 0.25)",
          cursor: "pointer",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
          fontSize: "13px",
          fontWeight: 600,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.boxShadow = "0 10px 35px rgba(0, 0, 0, 0.6), 0 0 22px rgba(99, 91, 255, 0.4)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 8px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(99, 91, 255, 0.25)";
        }}
      >
        <div
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            backgroundColor: "#635BFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFFFFF",
          }}
        >
          {isOpen ? <X size={14} /> : <MessageSquare size={14} />}
        </div>
        <span>AI Feedback</span>
      </button>
    </div>
  );
}
