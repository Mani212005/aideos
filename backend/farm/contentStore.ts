/**
 * File Description: The content-addressed store of the farm and the bounded worker cache built on it. Objects are read-only files named by the SHA-256 of their bytes (`objects/ab/<digest>`), written through `tmp/` and renamed into place, so a put is atomic and a repeat is a no-op. The cache fetches objects from any BlobSource (the seam for a future object store), verifies each digest on the way in and evicts least recently used objects above a byte bound.
 * Inputs and outputs: bytes, files and streams -> digests and object paths; a digest and a BlobSource -> a verified local file; a byte bound -> evicted objects.
 * Used by: backend/farm/worker.ts, backend/farm/gc.ts, backend/farm/janitor.ts, backend/farm/submit.ts, backend/farm/renderExecutor.ts, scripts/farm.ts.
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDigest, type Digest } from "./taskSpec";

/** Anything a cache can fetch from: a directory store today, an object store later. */
export interface BlobSource {
  has(digest: Digest): boolean;
  readStream(digest: Digest): Readable;
}

/** What a put reports. */
export interface PutResult {
  digest: Digest;
  size: number;
  /** True when the object was already stored, so nothing new was written. */
  existed: boolean;
}

/** One stored object as the sweeper sees it. */
export interface StoredObject {
  digest: Digest;
  size: number;
  /** Last put or use, in epoch milliseconds. */
  mtimeMs: number;
}

/** Raised when fetched or written bytes do not hash to the digest that named them. */
export class DigestMismatchError extends Error {
  readonly expected: Digest;
  readonly actual: Digest;
  /** Names both digests so a corrupted store is easy to find. */
  constructor(expected: Digest, actual: Digest) {
    super(`DIGEST_MISMATCH: expected ${expected} but the bytes hash to ${actual}`);
    this.name = "DigestMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

/** Raised when an object a task needs is not in its source. */
export class MissingBlobError extends Error {
  readonly digest: Digest;
  /** Names the missing digest. */
  constructor(digest: Digest) {
    super(`MISSING_BLOB: ${digest} is not in the store`);
    this.name = "MissingBlobError";
    this.digest = digest;
  }
}

export interface ContentStoreOptions {
  /** Clock in epoch milliseconds; stamps object times so tests can age objects. */
  now?: () => number;
}

/** Recursively adds up the sizes of the files under a directory (0 when it does not exist). */
export function directoryBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += directoryBytes(full);
      else if (entry.isFile() || entry.isSymbolicLink()) total += fs.lstatSync(full).size;
    } catch {
      // The file vanished between the listing and the stat; it no longer counts.
    }
  }
  return total;
}

/** Creates the store under `root`; the directory is created on first use. */
export function createContentStore(root: string, options: ContentStoreOptions = {}) {
  const now = options.now ?? Date.now;
  const objectsDir = path.join(root, "objects");
  const tmpDir = path.join(root, "tmp");

  /** The path of an object, whether or not it exists. */
  const pathOf = (digest: Digest): string => {
    if (!isDigest(digest)) throw new Error(`not a SHA-256 digest: ${String(digest)}`);
    return path.join(objectsDir, digest.slice(0, 2), digest);
  };

  /** Stamps an object's modification time, which is its last use. */
  const touch = (digest: Digest): void => {
    const seconds = now() / 1000;
    try {
      fs.utimesSync(pathOf(digest), seconds, seconds);
    } catch {
      // A concurrent sweep may have removed it; the caller finds out when it reads.
    }
  };

  /** Streams bytes into a temp file while hashing, then renames the file to its digest. */
  const putStream = async (source: Readable, check?: { expect?: Digest }): Promise<PutResult> => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `put-${process.pid}-${randomBytes(6).toString("hex")}`);
    const hash = createHash("sha256");
    let size = 0;
    const counter = new Transform({
      /** Hashes and counts each chunk and passes it on unchanged. */
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    });
    try {
      await pipeline(source, counter, fs.createWriteStream(tmp, { mode: 0o644 }));
      const digest = hash.digest("hex");
      if (check?.expect && check.expect !== digest) throw new DigestMismatchError(check.expect, digest);
      const target = pathOf(digest);
      if (fs.existsSync(target)) {
        fs.rmSync(tmp, { force: true });
        touch(digest);
        return { digest, size, existed: true };
      }
      fs.chmodSync(tmp, 0o444);
      const seconds = now() / 1000;
      fs.utimesSync(tmp, seconds, seconds);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(tmp, target);
      return { digest, size, existed: false };
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw error;
    }
  };

  return {
    root,
    objectsDir,
    tmpDir,
    pathOf,
    touch,
    putStream,

    /** True when the object is stored. */
    has(digest: Digest): boolean {
      return isDigest(digest) && fs.existsSync(pathOf(digest));
    },

    /** The size of a stored object in bytes, or null when it is not stored. */
    sizeOf(digest: Digest): number | null {
      try {
        return fs.statSync(pathOf(digest)).size;
      } catch {
        return null;
      }
    },

    /** Stores bytes and returns their digest. */
    putBytes(bytes: Uint8Array | string, check?: { expect?: Digest }): Promise<PutResult> {
      return putStream(Readable.from([Buffer.from(bytes)]), check);
    },

    /** Stores a file by copying it, so later changes to the original cannot reach the store. */
    putFile(file: string, check?: { expect?: Digest }): Promise<PutResult> {
      return putStream(fs.createReadStream(file), check);
    },

    /** Reads a whole object; use only for small objects such as an IR. */
    readBytes(digest: Digest): Buffer {
      try {
        return fs.readFileSync(pathOf(digest));
      } catch {
        throw new MissingBlobError(digest);
      }
    },

    /** Opens an object for reading; throws MissingBlobError when it is absent. */
    readStream(digest: Digest): Readable {
      if (!fs.existsSync(pathOf(digest))) throw new MissingBlobError(digest);
      touch(digest);
      return fs.createReadStream(pathOf(digest));
    },

    /** Gives a task its own path to an object: a hard link when the disks match, a copy otherwise. */
    materialize(digest: Digest, dest: string): void {
      const source = pathOf(digest);
      if (!fs.existsSync(source)) throw new MissingBlobError(digest);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.rmSync(dest, { force: true });
      try {
        fs.linkSync(source, dest);
      } catch {
        fs.copyFileSync(source, dest);
      }
    },

    /** Re-hashes an object and reports whether its bytes still match its name. */
    async verify(digest: Digest): Promise<boolean> {
      if (!isDigest(digest) || !fs.existsSync(pathOf(digest))) return false;
      const hash = createHash("sha256");
      for await (const chunk of fs.createReadStream(pathOf(digest))) hash.update(chunk as Buffer);
      return hash.digest("hex") === digest;
    },

    /** Lists every stored object with its size and last use. */
    list(): StoredObject[] {
      const out: StoredObject[] = [];
      let shards: string[];
      try {
        shards = fs.readdirSync(objectsDir);
      } catch {
        return out;
      }
      for (const shard of shards) {
        let names: string[];
        try {
          names = fs.readdirSync(path.join(objectsDir, shard));
        } catch {
          continue;
        }
        for (const name of names) {
          if (!isDigest(name)) continue;
          try {
            const stat = fs.statSync(path.join(objectsDir, shard, name));
            out.push({ digest: name, size: stat.size, mtimeMs: stat.mtimeMs });
          } catch {
            // Removed while listing.
          }
        }
      }
      return out;
    },

    /** Removes one object and returns the bytes it held (0 when it was not stored). */
    remove(digest: Digest): number {
      let size: number;
      try {
        size = fs.statSync(pathOf(digest)).size;
      } catch {
        return 0;
      }
      fs.rmSync(pathOf(digest), { force: true });
      return size;
    },

    /** Removes unfinished puts older than `olderThanMs` (a killed worker leaves them behind). */
    sweepTmp(olderThanMs: number): { removed: number; bytes: number } {
      let removed = 0;
      let bytes = 0;
      let names: string[];
      try {
        names = fs.readdirSync(tmpDir);
      } catch {
        return { removed, bytes };
      }
      const cutoff = now() - olderThanMs;
      for (const name of names) {
        const full = path.join(tmpDir, name);
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs > cutoff) continue;
          bytes += stat.size;
          fs.rmSync(full, { recursive: true, force: true });
          removed++;
        } catch {
          // Gone already.
        }
      }
      return { removed, bytes };
    },

    /** Total bytes of all stored objects. */
    totalBytes(): number {
      return this.list().reduce((sum, object) => sum + object.size, 0);
    },

    /** Bytes of unfinished puts. */
    tmpBytes(): number {
      return directoryBytes(tmpDir);
    },
  };
}

export type ContentStore = ReturnType<typeof createContentStore>;

/** What an eviction pass did. */
export interface EvictReport {
  removed: number;
  bytes: number;
  remainingBytes: number;
}

export interface LocalCacheOptions {
  /** Bytes the cache may hold after an eviction pass; the plan's value is 5 GiB. */
  maxBytes: number;
  now?: () => number;
}

/** A bounded worker cache: fetches verified objects from a source and evicts the least recently used. */
export function createLocalCache(root: string, options: LocalCacheOptions) {
  const store = createContentStore(root, { now: options.now });
  let hits = 0;
  let misses = 0;
  let fetchedBytes = 0;

  return {
    store,

    /** Returns a local path for an object, fetching it from the source when the cache lacks it. */
    async ensure(source: BlobSource, digest: Digest): Promise<{ path: string; hit: boolean }> {
      if (store.has(digest)) {
        hits++;
        store.touch(digest);
        return { path: store.pathOf(digest), hit: true };
      }
      if (!source.has(digest)) throw new MissingBlobError(digest);
      const put = await store.putStream(source.readStream(digest), { expect: digest });
      misses++;
      fetchedBytes += put.size;
      return { path: store.pathOf(digest), hit: false };
    },

    /** Removes least recently used objects until the cache is within its bound; `protect` objects stay. */
    evict(protect: ReadonlySet<Digest> = new Set()): EvictReport {
      const objects = store.list().sort((a, b) => a.mtimeMs - b.mtimeMs);
      let total = objects.reduce((sum, object) => sum + object.size, 0);
      let removed = 0;
      let bytes = 0;
      for (const object of objects) {
        if (total <= options.maxBytes) break;
        if (protect.has(object.digest)) continue;
        const freed = store.remove(object.digest);
        total -= freed;
        bytes += freed;
        removed++;
      }
      return { removed, bytes, remainingBytes: total };
    },

    /** Fetch counts since the cache was created. */
    stats(): { hits: number; misses: number; fetchedBytes: number } {
      return { hits, misses, fetchedBytes };
    },
  };
}

export type LocalCache = ReturnType<typeof createLocalCache>;
