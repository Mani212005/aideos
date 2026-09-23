/**
 * File Description: The agent link: how a studio (hosted or local) reaches the coding agent in the
 * owner's own terminal. The machine dials out, so no port is ever opened on it.
 *
 * 1. The studio asks for a pairing code. The browser gets an owner key it keeps, and a one-time
 *    code (10 minutes) to type into `aideos connect`.
 * 2. The connector claims the code and receives a secret connection token.
 * 3. The connector long-polls for tasks with that token; tasks reach it only when the request that
 *    created them carried the owner key it was paired with, so nobody else who can open the studio
 *    can send prompts to an agent running on the owner's machine.
 *
 * Secrets are stored hashed. State lives in one JSON file so pairings survive a server restart;
 * queued tasks are kept in memory only (a task nobody picks up in time is reported as undelivered).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Agents the connector knows how to run headless. */
export const LINK_AGENTS = ["claude", "agy", "codex", "opencode"] as const;
export type LinkAgent = (typeof LINK_AGENTS)[number];

/** Display names for the studio. */
export const LINK_AGENT_LABEL: Record<LinkAgent, string> = {
  claude: "Claude Code",
  agy: "Antigravity",
  codex: "Codex",
  opencode: "OpenCode",
};

const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
/** A connection that has not polled for this long is shown as offline. */
export const LINK_OFFLINE_AFTER_MS = 45 * 1000;
/** Longest a connector poll is held open before it returns empty and polls again. */
export const LINK_POLL_HOLD_MS = 25 * 1000;

/** A task handed to the connector. */
export interface LinkTask {
  id: string;
  eventType: string;
  filmId: string;
  prompt: string;
  createdAt: string;
}

/** What happened to a task, as the connector reports it. */
export interface LinkTaskResult {
  taskId: string;
  ok: boolean;
  summary: string;
  at: string;
}

interface StoredConnection {
  id: string;
  tokenHash: string;
  ownerHash: string;
  agent: LinkAgent;
  machine: string;
  createdAt: string;
  lastSeen: string;
}

interface StoredState {
  pairCodes: Record<string, { ownerHash: string; expiresAt: number }>;
  connections: StoredConnection[];
}

/** The public view of a connection, safe to send to the browser. */
export interface LinkStatus {
  connected: boolean;
  online: boolean;
  agent?: LinkAgent;
  agentLabel?: string;
  machine?: string;
  lastSeen?: string;
  pending: number;
  lastResult?: LinkTaskResult;
}

// Hashes a secret for storage and comparison.
function hash(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

// Makes a random url-safe secret.
function secret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

// Makes a short pairing code that is easy to type (no 0/O/1/I).
function pairCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join("");
  return `${pick()}-${pick()}`;
}

/** The agent link state for one studio server. */
export class AgentLinkStore {
  private state: StoredState;
  private queues = new Map<string, LinkTask[]>();
  private waiters = new Map<string, Array<(task: LinkTask | null) => void>>();
  private results = new Map<string, LinkTaskResult>();

  private readonly file: string;
  private readonly now: () => number;

  // Plain fields rather than parameter properties: the editor build allows only erasable syntax.
  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    this.state = this.load();
  }

  // Reads the state file, or starts empty.
  private load(): StoredState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return { pairCodes: raw.pairCodes ?? {}, connections: raw.connections ?? [] };
    } catch {
      return { pairCodes: {}, connections: [] };
    }
  }

  // Writes the state file (owner-only permissions: it holds hashes of secrets).
  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  // Drops pairing codes that have expired.
  private prune(): void {
    const t = this.now();
    for (const [code, entry] of Object.entries(this.state.pairCodes)) if (entry.expiresAt < t) delete this.state.pairCodes[code];
  }

  // Finds the connection paired with an owner key.
  private byOwner(ownerKey: string | undefined): StoredConnection | undefined {
    if (!ownerKey) return undefined;
    const h = hash(ownerKey);
    return this.state.connections.find((c) => c.ownerHash === h);
  }

  // Finds the connection a connector token belongs to.
  private byToken(token: string | undefined): StoredConnection | undefined {
    if (!token) return undefined;
    const h = hash(token);
    return this.state.connections.find((c) => c.tokenHash === h);
  }

  /** Starts pairing. Reuses the browser's owner key when it has one, so re-pairing replaces the old agent. */
  startPairing(existingOwnerKey?: string): { ownerKey: string; code: string; expiresAt: string } {
    this.prune();
    const ownerKey = existingOwnerKey && existingOwnerKey.length >= 32 ? existingOwnerKey : secret();
    const code = pairCode();
    const expiresAt = this.now() + PAIR_CODE_TTL_MS;
    this.state.pairCodes[code] = { ownerHash: hash(ownerKey), expiresAt };
    this.save();
    return { ownerKey, code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Claims a pairing code for a connector. Returns its token, or null when the code is wrong or expired. */
  claim(code: string, agent: LinkAgent, machine: string): { token: string } | null {
    this.prune();
    const entry = this.state.pairCodes[code.trim().toUpperCase()];
    if (!entry) return null;
    delete this.state.pairCodes[code.trim().toUpperCase()];
    const token = secret();
    const at = new Date(this.now()).toISOString();
    // One agent per owner: pairing again replaces the previous connection.
    const replaced = this.state.connections.filter((c) => c.ownerHash === entry.ownerHash);
    for (const old of replaced) this.release(old.id);
    this.state.connections = this.state.connections.filter((c) => c.ownerHash !== entry.ownerHash);
    this.state.connections.push({
      id: secret(9),
      tokenHash: hash(token),
      ownerHash: entry.ownerHash,
      agent,
      machine: machine.slice(0, 80) || "unknown machine",
      createdAt: at,
      lastSeen: at,
    });
    this.save();
    return { token };
  }

  /** True when a connector token is valid. */
  isConnector(token: string | undefined): boolean {
    return Boolean(this.byToken(token));
  }

  /** The owner's connection, as the studio shows it. */
  status(ownerKey: string | undefined): LinkStatus {
    const c = this.byOwner(ownerKey);
    if (!c) return { connected: false, online: false, pending: 0 };
    // A connector holding a poll open is checking in right now.
    if (this.waiters.get(c.id)?.length) c.lastSeen = new Date(this.now()).toISOString();
    return {
      connected: true,
      online: this.now() - Date.parse(c.lastSeen) < LINK_OFFLINE_AFTER_MS,
      agent: c.agent,
      agentLabel: LINK_AGENT_LABEL[c.agent],
      machine: c.machine,
      lastSeen: c.lastSeen,
      pending: this.queues.get(c.id)?.length ?? 0,
      ...(this.results.get(c.id) ? { lastResult: this.results.get(c.id) } : {}),
    };
  }

  /** Forgets the owner's connection; its connector gets a 401 on its next poll. */
  disconnect(ownerKey: string | undefined): boolean {
    const c = this.byOwner(ownerKey);
    if (!c) return false;
    this.release(c.id);
    this.state.connections = this.state.connections.filter((x) => x.id !== c.id);
    this.save();
    return true;
  }

  // Ends any poll held open for a connection and drops its queue.
  private release(connectionId: string): void {
    for (const resolve of this.waiters.get(connectionId) ?? []) resolve(null);
    this.waiters.delete(connectionId);
    this.queues.delete(connectionId);
    this.results.delete(connectionId);
  }

  /**
   * Queues a task for the agent paired with this owner key. Returns false when the owner has no
   * online agent, so the caller can say so instead of letting the task vanish.
   */
  enqueue(ownerKey: string | undefined, task: Omit<LinkTask, "createdAt">): boolean {
    const c = this.byOwner(ownerKey);
    if (!c || this.now() - Date.parse(c.lastSeen) >= LINK_OFFLINE_AFTER_MS) return false;
    const full: LinkTask = { ...task, createdAt: new Date(this.now()).toISOString() };
    const waiting = this.waiters.get(c.id);
    const resolve = waiting?.shift();
    if (resolve) resolve(full);
    else this.queues.set(c.id, [...(this.queues.get(c.id) ?? []), full]);
    return true;
  }

  /** Hands the connector its next task, holding the poll open up to `holdMs` when none is queued. */
  async next(token: string | undefined, holdMs = LINK_POLL_HOLD_MS): Promise<LinkTask | null | "unauthorized"> {
    const c = this.byToken(token);
    if (!c) return "unauthorized";
    c.lastSeen = new Date(this.now()).toISOString();
    this.save();
    const queued = this.queues.get(c.id);
    if (queued?.length) return queued.shift()!;
    if (holdMs <= 0) return null;
    return new Promise((resolve) => {
      const list = this.waiters.get(c.id) ?? [];
      let settled = false;
      const done = (task: LinkTask | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const rest = (this.waiters.get(c.id) ?? []).filter((w) => w !== done);
        if (rest.length) this.waiters.set(c.id, rest);
        else this.waiters.delete(c.id);
        resolve(task);
      };
      const timer = setTimeout(() => done(null), holdMs);
      if (typeof timer.unref === "function") timer.unref();
      list.push(done);
      this.waiters.set(c.id, list);
    });
  }

  /** Records what a task came to, as the connector reports it. */
  report(token: string | undefined, result: Omit<LinkTaskResult, "at">): boolean {
    const c = this.byToken(token);
    if (!c) return false;
    this.results.set(c.id, { ...result, summary: result.summary.slice(0, 2000), at: new Date(this.now()).toISOString() });
    return true;
  }
}

let shared: AgentLinkStore | null = null;

/** The studio server's agent link, stored under .aideos/ at the repo root. */
export function agentLink(): AgentLinkStore {
  if (!shared) shared = new AgentLinkStore(path.resolve(__dirname, "../../.aideos/agent-link.json"));
  return shared;
}
