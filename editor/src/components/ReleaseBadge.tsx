/**
 * File Description: Persistent Git-derived channel marker, browser title and tinted favicon.
 * Inputs and outputs: local channel endpoint -> header badge, edge strip and browser identity.
 * Used by: editor/src/App.tsx.
 */

import { useEffect, useState } from "react";
import { z } from "zod";

const channelSchema = z.object({ channel: z.enum(["stable", "dev"]), label: z.string(), description: z.string(), root: z.string() });
const unknownChannel = { channel: "dev", label: "DEV", description: "AIDEOS DEV (Git identity unavailable)", root: "" } satisfies z.infer<typeof channelSchema>;

/** Keeps the header and browser identity in sync with the server's actual checkout. */
export function ReleaseBadge() {
  const [info, setInfo] = useState<z.infer<typeof channelSchema>>(unknownChannel);
  useEffect(() => {
    let disposed = false;
    /** Reads fresh Git state and falls back to DEV when identity cannot be verified. */
    const refresh = async () => {
      try {
        const response = await fetch("/api/release-channel");
        const next = channelSchema.parse(await response.json());
        if (!disposed) setInfo(next);
      } catch { if (!disposed) setInfo(unknownChannel); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.releaseChannel = info.channel;
    document.title = `[${info.label}] Aideos Studio`;
    const tokens = getComputedStyle(document.documentElement);
    const color = tokens.getPropertyValue(info.channel === "stable" ? "--nb-success" : "--nb-warn").trim();
    const ink = tokens.getPropertyValue("--nb-ink").trim();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="${color}"/><path d="M7 25 13 7h6l6 18h-5l-1-4h-6l-1 4zm7-8h4l-2-7z" fill="${ink}"/></svg>`;
    for (const link of document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) link.remove();
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    document.head.append(icon);
    return () => icon.remove();
  }, [info]);
  return <>
    <div className="release-strip" aria-hidden="true" />
    <span className="release-badge" title={`${info.description}\n${info.root}`} aria-label={info.description}>
      <span className="font-sans text-[13px] font-black">Aideos</span>
      <span className="font-mono text-[10px] font-bold">{info.label}</span>
    </span>
  </>;
}
