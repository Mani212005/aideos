/**
 * File Description: Derives the local release channel from Git rather than a configurable label.
 * Inputs and outputs: checkout directory -> channel, release tag, commit, dirty state and default port.
 * Used by: scripts/release.ts, scripts/channel.ts and editor/vite.config.ts.
 */

import { execFileSync } from "node:child_process";

/** Reads Git metadata without allowing inherited Git directory overrides. */
export function git(root: string, args: string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Reads optional Git metadata, returning an empty string when a ref does not exist. */
export function optionalGit(root: string, args: string[]): string {
  try { return git(root, args); } catch { return ""; }
}

/** Derives a channel only from the checked-out branch, exact release tag and clean tree. */
export function releaseChannel(root: string) {
  const commit = optionalGit(root, ["rev-parse", "--short=7", "HEAD"]) || "unknown";
  const branch = optionalGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) || "detached";
  const dirty = Boolean(optionalGit(root, ["status", "--porcelain", "--untracked-files=normal"]));
  const tag = optionalGit(root, ["tag", "--points-at", "HEAD", "--sort=-version:refname"]).split("\n")
    .find((value) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) || "";
  const stable = branch === "stable" && Boolean(tag) && !dirty;
  const aheadText = optionalGit(root, ["rev-list", "--count", "stable..HEAD"]) || optionalGit(root, ["rev-list", "--count", "origin/stable..HEAD"]);
  const ahead = aheadText ? Number(aheadText) : null;
  const label = stable ? `STABLE ${tag}` : "DEV";
  const description = stable ? `AIDEOS ${label} (commit ${commit})`
    : `AIDEOS DEV ${branch}@${commit}${dirty ? " + UNCOMMITTED CHANGES" : ""}${ahead === null ? "" : ` (${ahead} commits ahead of stable)`}`;
  return { channel: stable ? "stable" : "dev", label, tag, commit, branch, dirty, ahead, description, root, port: stable ? 3002 : 3001 };
}
