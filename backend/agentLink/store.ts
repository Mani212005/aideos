/**
 * File Description: The agent link: how a studio (hosted or local) reaches the coding agent the
 * owner runs on their own machine. The machine dials out, so no port is ever opened on it.
 *
 * Two ways in, one identity model:
 *  - connector: `aideos connect <code>` claims a pairing and long-polls for tasks and runs each
 *    through the agent's headless mode.
 *  - agent: the owner starts their own coding agent, adds the studio's MCP endpoint with a link
 *    token, and the agent calls `aideos_wait_for_task` in its normal visible session.
 *
 * Durability: the hosted studio runs on a free-plan container whose filesystem is wiped on every
 * restart, spin-down and redeploy, so nothing that must survive lives only on disk or in memory.
 *  - Connection tokens are signed (HMAC) and carry their own identity (owner hash, agent,
 *    machine, issue time), so any restart of the server still recognises them; the connection
 *    table is rebuilt from the next authenticated request.
 *  - The signing key comes from AIDEOS_LINK_SECRET, else is derived from a provider key the
 *    deployment already holds, else is generated into a file (local development).
 *  - Ending a connection needs no stored revocation to be safe: the browser rotates its owner key
 *    on Disconnect (tokens are bound to the owner key's hash), and a connection also ends when the
 *    owner's browser stops heartbeating (studio status polls) for the grace period, so closing the
 *    website ends it while a reload or brief network loss does not.
 * State that can be kept (pairing codes, the connection table, revocations) is also written to one
 * JSON file so a local server keeps it across restarts. Queued tasks are memory-only (a task nobody
 * picks up in time is reported as undelivered).
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

/** How a coding agent is linked: the downloadable connector, or the agent's own MCP session. */
export type LinkMode = "connector" | "agent";

const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
/** A connector that has not polled for this long is shown as offline. */
export const LINK_OFFLINE_AFTER_MS = 45 * 1000;
/** An agent working in its own session calls the studio less steadily (model turns between calls). */
export const LINK_AGENT_OFFLINE_AFTER_MS = 3 * 60 * 1000;
/** Longest a connector poll is held open before it returns empty and polls again. */
export const LINK_POLL_HOLD_MS = 25 * 1000;
/** How long after the owner's browser last checked in a connection is kept (reloads, brief network loss). */
export const LINK_PRESENCE_GRACE_MS = 5 * 60 * 1000;
/** A delivered task keeps its agent shown as online this long even between check-ins. */
const TASK_BUSY_MS = 30 * 60 * 1000;
const ACTIVITY_KEEP = 60;

/** A task handed to the agent. */
export interface LinkTask {
  id: string;
  eventType: string;
  filmId: string;
  prompt: string;
  createdAt: string;
}

/** What happened to a task, as the agent reports it. */
export interface LinkTaskResult {
  taskId: string;
  ok: boolean;
  summary: string;
  at: string;
}

/** One line of what the agent is doing, recorded from its real tool calls. */
export interface LinkActivity {
  seq: number;
  at: string;
  text: string;
}

/** Why a token is no longer accepted. */
export type EndReason = "replaced" | "disconnected" | "tab-closed" | "unknown";

interface Connection {
  cid: string;
  ownerHash: string;
  iat: number;
  mode: LinkMode;
  agent: LinkAgent;
  machine: string;
  createdAt: string;
  lastSeen: string;
  busySince?: number;
}

/** Who replaced a dropped connection, so its next poll can say so instead of just 401. */
export interface ReplacementNote {
  agent: LinkAgent;
  agentLabel: string;
  machine: string;
  at: string;
}

interface StoredState {
  pairCodes: Record<string, { ownerHash: string; expiresAt: number }>;
  connections: Connection[];
  /** Per owner: tokens issued at or before this time are dead, with the reason. */
  revoked: Record<string, { before: number; reason: EndReason }>;
}

/** The public view of a connection, safe to send to the browser. */
export interface LinkStatus {
  /** When this server process started: a browser that remembers a link older than this knows a restart wiped it. */
  startedAt: string;
  connected: boolean;
  online: boolean;
  mode?: LinkMode;
  agent?: LinkAgent;
  agentLabel?: string;
  machine?: string;
  lastSeen?: string;
  busy?: boolean;
  pending: number;
  lastResult?: LinkTaskResult;
  activity?: LinkActivity[];
}

/** The signed identity a token carries. */
interface TokenClaims {
  k: "c" | "p";
  oh: string;
  iat: number;
  ag?: LinkAgent;
  m?: string;
  md?: LinkMode;
  exp?: number;
}

// Hashes a secret for storage and comparison.
function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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

/**
 * The key link tokens are signed with. It must be the same across restarts or every pairing dies
 * with the process: AIDEOS_LINK_SECRET when set, else derived from a provider key the deployment
 * already holds (stable across restarts, never sent anywhere), else a generated file (local dev).
 */
export function resolveLinkSecret(file: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.AIDEOS_LINK_SECRET && env.AIDEOS_LINK_SECRET.length >= 16) return env.AIDEOS_LINK_SECRET;
  for (const name of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "DEEPGRAM_API_KEY", "PARALLEL_API_KEY"]) {
    const value = env[name];
    if (value && value.length >= 8) return crypto.createHmac("sha256", value).update("aideos-agent-link-signing-key-v1").digest("base64url");
  }
  const keyFile = `${file}.key`;
  try {
    const existing = fs.readFileSync(keyFile, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    // No key yet: make one below.
  }
  const fresh = secret();
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, fresh, { mode: 0o600 });
  } catch {
    // Read-only filesystem: the key then lasts only this process, like the old in-memory state.
  }
  return fresh;
}

/** The agent link state for one studio server. */
export class AgentLinkStore {
  private state: StoredState;
  private queues = new Map<string, LinkTask[]>();
  private waiters = new Map<string, Array<(task: LinkTask | null) => void>>();
  private results = new Map<string, LinkTaskResult>();
  private activities = new Map<string, LinkActivity[]>();
  private activitySeq = 0;
  /** Last time each owner's browser checked in. Unknown owners count from boot. */
  private presence = new Map<string, number>();
  private usedPairings = new Set<string>();
  private lastIat = 0;

  private readonly file: string;
  private readonly now: () => number;
  private readonly key: string;
  private readonly graceMs: number;
  private readonly bootAt: number;

  // Plain fields rather than parameter properties: the editor build allows only erasable syntax.
  constructor(file: string, now: () => number = Date.now, options: { secret?: string; presenceGraceMs?: number } = {}) {
    this.file = file;
    this.now = now;
    this.key = options.secret ?? resolveLinkSecret(file);
    this.graceMs = options.presenceGraceMs ?? LINK_PRESENCE_GRACE_MS;
    this.bootAt = now();
    this.state = this.load();
  }

  // Reads the state file, or starts empty.
  private load(): StoredState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return { pairCodes: raw.pairCodes ?? {}, connections: raw.connections ?? [], revoked: raw.revoked ?? {} };
    } catch {
      return { pairCodes: {}, connections: [], revoked: {} };
    }
  }

  // Writes the state file (owner-only permissions); a filesystem that refuses is not an error.
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    } catch {
      // Tokens are self-verifying, so the link keeps working without this file.
    }
  }

  // Drops pairing codes that have expired.
  private prune(): void {
    const t = this.now();
    for (const [code, entry] of Object.entries(this.state.pairCodes)) if (entry.expiresAt < t) delete this.state.pairCodes[code];
  }

  // Signs claims into a token with the given prefix.
  private sign(prefix: "alt1" | "alp1", claims: TokenClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const sig = crypto.createHmac("sha256", this.key).update(`${prefix}.${body}`).digest("base64url");
    return `${prefix}.${body}.${sig}`;
  }

  // Verifies a token's signature and shape, returning its claims or null.
  private verify(token: string | undefined, prefix: "alt1" | "alp1"): TokenClaims | null {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== prefix) return null;
    const expected = crypto.createHmac("sha256", this.key).update(`${prefix}.${parts[1]}`).digest();
    let given: Buffer;
    try {
      given = Buffer.from(parts[2], "base64url");
    } catch {
      return null;
    }
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as TokenClaims;
      return typeof claims?.oh === "string" && typeof claims.iat === "number" ? claims : null;
    } catch {
      return null;
    }
  }

  // Issue times strictly increase, so of two tokens for one owner the newer is always decidable.
  private nextIat(): number {
    this.lastIat = Math.max(this.now(), this.lastIat + 1);
    return this.lastIat;
  }

  // Records that an owner's browser is present right now.
  private beat(ownerHash: string): void {
    this.presence.set(ownerHash, this.now());
  }

  // The connection currently held by an owner.
  private connOf(ownerHash: string): Connection | undefined {
    return this.state.connections.find((c) => c.ownerHash === ownerHash);
  }

  // Ends an owner's connection: every token issued so far stops working.
  private revoke(ownerHash: string, reason: EndReason): void {
    this.lastIat = Math.max(this.lastIat, this.now());
    this.state.revoked[ownerHash] = { before: this.now(), reason };
    const c = this.connOf(ownerHash);
    if (c) {
      this.release(c.cid);
      this.state.connections = this.state.connections.filter((x) => x.cid !== c.cid);
    }
    this.save();
  }

  /** Signals the owner's browser is open; called by every studio status poll and pairing. */
  heartbeat(ownerKey: string | undefined): void {
    if (ownerKey && ownerKey.length >= 32) this.beat(hash(ownerKey));
  }

  /** Starts a connector pairing: a short typed code plus a long signed form the command uses. */
  startPairing(existingOwnerKey?: string): { ownerKey: string; code: string; pairingToken: string; expiresAt: string } {
    this.prune();
    const ownerKey = existingOwnerKey && existingOwnerKey.length >= 32 ? existingOwnerKey : secret();
    const ownerHash = hash(ownerKey);
    this.beat(ownerHash);
    const code = pairCode();
    const expiresAt = this.now() + PAIR_CODE_TTL_MS;
    this.state.pairCodes[code] = { ownerHash, expiresAt };
    this.save();
    // The signed form outlives a server restart (the short code lives in memory and the file).
    const pairingToken = this.sign("alp1", { k: "p", oh: ownerHash, iat: this.now(), exp: expiresAt });
    return { ownerKey, code, pairingToken, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * Issues the token an agent uses from its own MCP session. The connection appears (and replaces
   * any older one) when the agent first calls the studio, so opening the dialog never drops a
   * working agent.
   */
  startAgentPairing(existingOwnerKey: string | undefined, agent: LinkAgent, machine = "your terminal"): { ownerKey: string; token: string } {
    const ownerKey = existingOwnerKey && existingOwnerKey.length >= 32 ? existingOwnerKey : secret();
    const ownerHash = hash(ownerKey);
    this.beat(ownerHash);
    const token = this.sign("alt1", { k: "c", oh: ownerHash, iat: this.nextIat(), ag: agent, m: machine.slice(0, 80), md: "agent" });
    return { ownerKey, token };
  }

  /**
   * Claims a pairing code (short or signed) for a connector. Returns its token, or null when the
   * code is wrong, expired or already used. One agent per owner: pairing again replaces the
   * previous connection, and the replaced agent is reported back so the new connector can say
   * whose terminal will go quiet.
   */
  claim(code: string, agent: LinkAgent, machine: string): { token: string; replaced: { agent: LinkAgent; agentLabel: string; machine: string } | null } | null {
    this.prune();
    const trimmed = code.trim();
    let ownerHash: string | undefined;
    if (trimmed.startsWith("alp1.")) {
      const claims = this.verify(trimmed, "alp1");
      if (!claims || claims.k !== "p" || (claims.exp ?? 0) < this.now() || this.usedPairings.has(trimmed)) return null;
      this.usedPairings.add(trimmed);
      ownerHash = claims.oh;
    } else {
      const entry = this.state.pairCodes[trimmed.toUpperCase()];
      if (!entry) return null;
      delete this.state.pairCodes[trimmed.toUpperCase()];
      ownerHash = entry.ownerHash;
    }
    const machineName = machine.slice(0, 80) || "unknown machine";
    const token = this.sign("alt1", { k: "c", oh: ownerHash, iat: this.nextIat(), ag: agent, m: machineName, md: "connector" });
    const claims = this.verify(token, "alt1")!;
    const before = this.connOf(ownerHash);
    this.register(claims);
    this.save();
    return { token, replaced: before ? { agent: before.agent, agentLabel: LINK_AGENT_LABEL[before.agent], machine: before.machine } : null };
  }

  // Makes a token's connection the owner's current one, releasing any older one.
  private register(claims: TokenClaims): Connection {
    const at = new Date(this.now()).toISOString();
    const previous = this.connOf(claims.oh);
    if (previous) this.release(previous.cid);
    this.state.connections = this.state.connections.filter((c) => c.ownerHash !== claims.oh);
    const conn: Connection = {
      cid: secret(9),
      ownerHash: claims.oh,
      iat: claims.iat,
      mode: claims.md ?? "connector",
      agent: claims.ag ?? "claude",
      machine: claims.m ?? "unknown machine",
      createdAt: at,
      lastSeen: at,
    };
    this.state.connections.push(conn);
    return conn;
  }

  /**
   * Checks a connection token: the live connection it belongs to, or why it is no longer good.
   * A server that restarted has no connection table; the first valid token rebuilds its entry.
   */
  authenticate(token: string | undefined): { conn: Connection } | { ended: EndReason } {
    const claims = this.verify(token, "alt1");
    if (!claims || claims.k !== "c") return { ended: "unknown" };
    const revoked = this.state.revoked[claims.oh];
    if (revoked && claims.iat <= revoked.before) return { ended: revoked.reason };
    const seen = this.presence.get(claims.oh) ?? this.bootAt;
    if (this.now() - seen > this.graceMs) {
      this.revoke(claims.oh, "tab-closed");
      return { ended: "tab-closed" };
    }
    let conn = this.connOf(claims.oh);
    if (conn && conn.iat > claims.iat) return { ended: "replaced" };
    if (!conn || conn.iat < claims.iat) {
      conn = this.register(claims);
      this.save();
    }
    conn.lastSeen = new Date(this.now()).toISOString();
    return { conn };
  }

  /**
   * What replaced the connection holding this token, if a newer pairing took over. Null for a
   * token that is not a superseded one (unknown, current, or ended some other way).
   */
  replacementNote(token: string | undefined): ReplacementNote | null {
    const claims = this.verify(token, "alt1");
    if (!claims) return null;
    const conn = this.connOf(claims.oh);
    if (!conn || conn.iat <= claims.iat) return null;
    return { agent: conn.agent, agentLabel: LINK_AGENT_LABEL[conn.agent], machine: conn.machine, at: conn.createdAt };
  }

  /** True when a connection token is currently good. */
  isConnector(token: string | undefined): boolean {
    return "conn" in this.authenticate(token);
  }

  /** Why a token was refused, for the connector's goodbye line. */
  endReason(token: string | undefined): EndReason {
    const result = this.authenticate(token);
    if ("ended" in result) return result.ended;
    return "unknown";
  }

  /** The owner's connection, as the studio shows it. Reading it is the browser's heartbeat. */
  status(ownerKey: string | undefined): LinkStatus {
    this.heartbeat(ownerKey);
    const c = ownerKey ? this.connOf(hash(ownerKey)) : undefined;
    if (!c) return { startedAt: new Date(this.bootAt).toISOString(), connected: false, online: false, pending: 0 };
    // A connector holding a poll open is checking in right now.
    if (this.waiters.get(c.cid)?.length) c.lastSeen = new Date(this.now()).toISOString();
    const busy = Boolean(c.busySince && this.now() - c.busySince < TASK_BUSY_MS);
    const window = c.mode === "agent" ? LINK_AGENT_OFFLINE_AFTER_MS : LINK_OFFLINE_AFTER_MS;
    return {
      startedAt: new Date(this.bootAt).toISOString(),
      connected: true,
      online: busy || this.now() - Date.parse(c.lastSeen) < window,
      mode: c.mode,
      agent: c.agent,
      agentLabel: LINK_AGENT_LABEL[c.agent],
      machine: c.machine,
      lastSeen: c.lastSeen,
      busy,
      pending: this.queues.get(c.cid)?.length ?? 0,
      ...(this.results.get(c.cid) ? { lastResult: this.results.get(c.cid) } : {}),
      activity: (this.activities.get(c.cid) ?? []).slice(-8),
    };
  }

  /**
   * Ends the owner's connection now. Tokens are bound to the owner key, so the browser rotating
   * its key afterwards is what keeps them dead across a server restart.
   */
  disconnect(ownerKey: string | undefined): boolean {
    if (!ownerKey || ownerKey.length < 32) return false;
    this.revoke(hash(ownerKey), "disconnected");
    return true;
  }

  // Ends any poll held open for a connection and drops its queue.
  private release(connectionId: string): void {
    for (const resolve of this.waiters.get(connectionId) ?? []) resolve(null);
    this.waiters.delete(connectionId);
    this.queues.delete(connectionId);
    this.results.delete(connectionId);
    this.activities.delete(connectionId);
  }

  /**
   * Queues a task for the agent paired with this owner key. Returns false when the owner has no
   * online agent, so the caller can say so instead of letting the task vanish.
   */
  enqueue(ownerKey: string | undefined, task: Omit<LinkTask, "createdAt">): boolean {
    if (!this.status(ownerKey).online) return false;
    const c = this.connOf(hash(ownerKey!));
    if (!c) return false;
    const full: LinkTask = { ...task, createdAt: new Date(this.now()).toISOString() };
    const waiting = this.waiters.get(c.cid);
    const resolve = waiting?.shift();
    if (resolve) resolve(full);
    else this.queues.set(c.cid, [...(this.queues.get(c.cid) ?? []), full]);
    return true;
  }

  /** Hands the agent its next task, holding the poll open up to `holdMs` when none is queued. */
  async next(token: string | undefined, holdMs = LINK_POLL_HOLD_MS): Promise<LinkTask | null | "unauthorized"> {
    const auth = this.authenticate(token);
    if (!("conn" in auth)) return "unauthorized";
    const c = auth.conn;
    this.save();
    const queued = this.queues.get(c.cid);
    if (queued?.length) return this.deliver(c, queued.shift()!);
    if (holdMs <= 0) return null;
    const task = await new Promise<LinkTask | null>((resolve) => {
      const list = this.waiters.get(c.cid) ?? [];
      let settled = false;
      const done = (t: LinkTask | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const rest = (this.waiters.get(c.cid) ?? []).filter((w) => w !== done);
        if (rest.length) this.waiters.set(c.cid, rest);
        else this.waiters.delete(c.cid);
        resolve(t);
      };
      const timer = setTimeout(() => done(null), holdMs);
      if (typeof timer.unref === "function") timer.unref();
      list.push(done);
      this.waiters.set(c.cid, list);
    });
    // A held poll that ended because the connection ended (not because the hold ran out) is a 401.
    if (!task && !this.connOf(c.ownerHash)) return "unauthorized";
    return task ? this.deliver(c, task) : null;
  }

  // Marks a connection busy with a delivered task.
  private deliver(c: Connection, task: LinkTask): LinkTask {
    c.busySince = this.now();
    this.record(c.cid, `received task: ${task.eventType} for ${task.filmId}`);
    return task;
  }

  /** Records what a task came to, as the agent reports it. */
  report(token: string | undefined, result: Omit<LinkTaskResult, "at">): boolean {
    const auth = this.authenticate(token);
    if (!("conn" in auth)) return false;
    const c = auth.conn;
    c.busySince = undefined;
    this.results.set(c.cid, { ...result, summary: result.summary.slice(0, 2000), at: new Date(this.now()).toISOString() });
    this.record(c.cid, result.ok ? "task finished" : "task failed");
    return true;
  }

  // Appends an activity line to a connection's ring buffer.
  private record(connectionId: string, text: string): void {
    const list = this.activities.get(connectionId) ?? [];
    list.push({ seq: ++this.activitySeq, at: new Date(this.now()).toISOString(), text: text.slice(0, 300) });
    this.activities.set(connectionId, list.slice(-ACTIVITY_KEEP));
  }

  /** Notes something the agent did (a tool call it made), shown in the connector and the studio. */
  recordActivity(token: string | undefined, text: string): void {
    const auth = this.authenticate(token);
    if ("conn" in auth) this.record(auth.conn.cid, text);
  }

  /** Activity lines after `since` (a seq), or null when the token is not good. */
  activity(token: string | undefined, since = 0): LinkActivity[] | null {
    const auth = this.authenticate(token);
    if (!("conn" in auth)) return null;
    return (this.activities.get(auth.conn.cid) ?? []).filter((a) => a.seq > since);
  }
}

let shared: AgentLinkStore | null = null;

/** The studio server's agent link, stored under .aideos/ at the repo root. */
export function agentLink(): AgentLinkStore {
  if (!shared) shared = new AgentLinkStore(path.resolve(__dirname, "../../.aideos/agent-link.json"));
  return shared;
}
