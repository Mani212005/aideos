/**
 * File Description: Splits the journeys CI job into parallel shards. Holds the committed per-journey duration table, lists the journey files on disk, and plans a deterministic, balanced, disjoint partition of every journey file plus the studio smoke step (longest first, greedy). No clock, no randomness, no network.
 * Inputs and outputs: a shard spec such as "2/3", the repo root and the journey weight table -> the journey files and the smoke step that one shard runs.
 * Used by: scripts/ci.ts (the journeys job), scripts/ciJourneyShards.test.ts, docs/CI.md.
 */

import fs from "node:fs";
import path from "node:path";

/** Where the journeys live, relative to the repo root. The same folder the `**` glob of the journey step selects. */
export const JOURNEY_DIR = "backend/journeys";

/** The suffix that makes a file a journey (the glob of `npm run test:journeys`). */
export const JOURNEY_SUFFIX = ".journey.ts";

/** The studio smoke step is planned as one more item so it lands on exactly one shard. */
export const SMOKE_ITEM = "studio smoke and scrub";

/** Seconds assumed for a journey file that has no entry in the table, so a new journey is still assigned and costed (about the heavy end of the median). */
export const DEFAULT_WEIGHT_SECONDS = 60;

/**
 * Median seconds of each journey file on a GitHub runner, summed over its tests, from 8 journeys
 * jobs of 13 to 14 November 2026 (data: per-test `duration_ms` of the TAP log). Keys are paths
 * relative to backend/journeys. The table only balances the shards: a stale or missing entry costs
 * balance, never coverage, because every file on disk is planned.
 */
export const JOURNEY_WEIGHTS_SECONDS: Readonly<Record<string, number>> = {
  "j3_j5_stage.journey.ts": 247,
  "j3_j4_dots.journey.ts": 197,
  "j1_pipeline.journey.ts": 134,
  "j2_retime.journey.ts": 90,
  "j6_resume.journey.ts": 88,
  "j13_caption_placement.journey.ts": 79,
  "j7_review_truth.journey.ts": 79,
  "characters.journey.ts": 77,
  "j14_soundtrack.journey.ts": 74,
  "stage_contracts.journey.ts": 61,
  "j12_render_disk.journey.ts": 50,
  "character_dots_pixels.journey.ts": 48,
  "character_retarget.journey.ts": 46,
  "j9_template.journey.ts": 42,
  "character_pixels.journey.ts": 36,
  "j4_character_crops.journey.ts": 35,
  "stage_review_truth.journey.ts": 28,
  "j9_svg_repeatability.journey.ts": 28,
  "j3_studio_edit.journey.ts": 28,
  "character_resume.journey.ts": 22,
  "j15_legacy_sfx_preview.journey.ts": 12,
  "j8_failures.journey.ts": 7,
  "master_audio.journey.ts": 1,
  [SMOKE_ITEM]: 27,
};

/** One shard of a job: its 1-based position and the total number of shards. */
export interface ShardSpec {
  index: number;
  total: number;
}

/** What one shard runs: its journey files (relative to the repo root), whether it owns the studio smoke step, and its planned seconds. */
export interface ShardPlan {
  shard: ShardSpec;
  journeyFiles: string[];
  runsSmoke: boolean;
  plannedSeconds: number;
}

/** One unit of planned work. */
export interface WorkItem {
  id: string;
  weight: number;
}

/** Parses "i/n" (for example "2/3") into a shard spec; throws a message naming the bad value. */
export function parseShardSpec(value: string): ShardSpec {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`invalid --shard "${value}": expected "<index>/<total>", for example 2/3`);
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || total < 1 || index < 1 || index > total) {
    throw new Error(`invalid --shard "${value}": the index must be between 1 and the total (at least 1)`);
  }
  return { index, total };
}

/** Lists every journey file under backend/journeys (any depth), as paths relative to the repo root, sorted. */
export function listJourneyFiles(root: string): string[] {
  const base = path.join(root, JOURNEY_DIR);
  if (!fs.existsSync(base)) throw new Error(`journey folder not found: ${base}`);
  const found: string[] = [];
  // Walks one folder, collecting journey files and descending into sub-folders.
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (entry.isFile() && entry.name.endsWith(JOURNEY_SUFFIX)) {
        found.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(base);
  return found.sort();
}

/** The weight of a work item: its table entry, else the default for an unlisted journey file. */
export function weightOf(id: string, weights: Readonly<Record<string, number>> = JOURNEY_WEIGHTS_SECONDS): number {
  const listed = weights[id];
  return typeof listed === "number" && Number.isFinite(listed) && listed > 0 ? listed : DEFAULT_WEIGHT_SECONDS;
}

/**
 * Partitions items into `total` groups, longest first: each item goes to the group with the least
 * planned time so far (ties go to the lowest group, items tie-break by id). Every item lands in exactly one group.
 */
export function partitionItems(items: WorkItem[], total: number): WorkItem[][] {
  if (!Number.isSafeInteger(total) || total < 1) throw new Error(`shard total must be a positive integer, got ${total}`);
  if (total > items.length) throw new Error(`cannot split ${items.length} work items into ${total} shards: a shard would run nothing`);
  const ids = new Set(items.map((i) => i.id));
  if (ids.size !== items.length) throw new Error("work item ids must be unique");
  const groups: WorkItem[][] = Array.from({ length: total }, () => []);
  const loads = new Array<number>(total).fill(0);
  const ordered = [...items].sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const item of ordered) {
    let target = 0;
    for (let i = 1; i < total; i++) if (loads[i] < loads[target]) target = i;
    groups[target].push(item);
    loads[target] += item.weight;
  }
  return groups;
}

/** Plans one shard: the journey files `journeyFiles` (repo-relative) and the smoke step are split across `shard.total` shards. */
export function planShard(
  shard: ShardSpec,
  journeyFiles: string[],
  weights: Readonly<Record<string, number>> = JOURNEY_WEIGHTS_SECONDS,
): ShardPlan {
  const prefix = `${JOURNEY_DIR}/`;
  const items: WorkItem[] = [
    ...journeyFiles.map((file) => {
      const id = file.startsWith(prefix) ? file.slice(prefix.length) : file;
      return { id, weight: weightOf(id, weights) };
    }),
    { id: SMOKE_ITEM, weight: weightOf(SMOKE_ITEM, weights) },
  ];
  const mine = partitionItems(items, shard.total)[shard.index - 1];
  return {
    shard,
    journeyFiles: mine.filter((i) => i.id !== SMOKE_ITEM).map((i) => `${prefix}${i.id}`).sort(),
    runsSmoke: mine.some((i) => i.id === SMOKE_ITEM),
    plannedSeconds: mine.reduce((sum, i) => sum + i.weight, 0),
  };
}

/** Plans one shard of the journeys that are on disk under `root`. */
export function planJourneyShard(shard: ShardSpec, root: string): ShardPlan {
  if (shard.index > shard.total) throw new Error(`shard ${shard.index}/${shard.total} is out of range`);
  return planShard(shard, listJourneyFiles(root));
}
