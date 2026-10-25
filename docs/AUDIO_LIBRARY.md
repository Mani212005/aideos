<!-- File Description: Documentation for the audio library manifest, caching, and aideos audio CLI commands. -->

# Audio Library and Management Commands

Aideos uses a committed, hash-locked audio library manifest (`audio/library.json`) for background music and sound effects. Audio files are never committed to git: licenses forbid re-hosting in a public repository, and keeping media out of source control protects repository size. Instead, assets are fetched on demand from source URLs into a local shared cache.

## 1. Commands

### `aideos audio fetch`
Fetches audio assets listed in `audio/library.json` into the shared cache (`videos/.audio-library`):

```bash
# Fetch all items in the library manifest
aideos audio fetch

# Fetch a single item by id
aideos audio fetch --item mk-556

# Force re-download even if already present
aideos audio fetch --force

# Fetch with JSON output
aideos audio fetch --json
```

- Downloads items sequentially (never crawls or scrapes).
- Verifies SHA256 checksums immediately upon download; mismatches are rejected and deleted.
- Skips items already present in the cache with matching SHA256 hashes.

### `aideos audio verify`
Verifies all cached audio assets against their declared SHA256 hashes:

```bash
# Verify entire library
aideos audio verify

# Verify a single item
aideos audio verify --item whoosh-soft

# Machine-readable JSON report
aideos audio verify --json
```

- Reports each item as `valid`, `missing`, `mismatch` (corrupt), or `unavailable` (manual item not yet imported).
- Exits with code 0 on PASS, or code 1 if any items fail verification.

### `aideos audio import`
Imports manual audio files (such as tracks downloaded manually from the YouTube Audio Library) into the shared cache:

```bash
aideos audio import <id> /path/to/track.mp3
```

- Verifies that the file exists and hashes it.
- If the manifest specifies a SHA256, refuses the import on hash mismatch.
- Copies the file into `videos/.audio-library/`.

## 2. Storage and Cache Layout

- **Manifest**: `audio/library.json` (schema `aideos.audio-library/1`) holds IDs, metadata, source URLs, licenses, SHA256 hashes, duration, and measured loudness (integrated LUFS, true peak dB, and LRA).
- **Cache**: Assets are saved to `videos/.audio-library/`, located next to personal video packages.
- **Serving**: Assets in `videos/.audio-library/` are served by Remotion's public server and the editor dev server (`/videos/*` middleware), while `listVideoPackages()` skips engine cache folders.
- **Git Ignore**: Git ignores `*.mp3`, `*.wav`, `*.ogg`, and the `videos/.audio-library/` directory.
