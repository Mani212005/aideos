<!-- File Description: Documentation for the audio library manifest, caching, and aideos audio CLI commands. -->

# Audio Library and Management Commands

Aideos uses a committed, hash-locked audio library manifest (`audio/library.json`) for background music and sound effects. Audio files are never committed to git; assets are fetched on demand from source URLs into a local shared cache, and the manifest records each item's license and attribution details. The current catalog includes Mixkit music and sound effects, plus sound effects from Freesound and Kenney.

## 1. Commands

### `aideos audio fetch`
Fetches audio assets listed in `audio/library.json` into `.audio-library/` inside the active videos directory (by default `videos/.audio-library/`):

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
- Refuses the import unless the file matches the SHA256 already recorded in the manifest.
- Copies the file into `.audio-library/` inside the active videos directory.

To add a manually downloaded track, first add its complete metadata to `audio/library.json` with `url: null`, including the expected SHA256, byte count, license details, duration, loudness, roles, moods, energy, and content ID risk. Then import the file using its manifest ID. `aideos audio verify` checks it against the same hash lock. Use this for tracks added manually from the YouTube Audio Library; the manifest records attribution when the track's license requires it.

## 2. Storage and Cache Layout

- **Manifest**: `audio/library.json` (schema `aideos.audio-library/1`) holds IDs, metadata, source URLs, licenses, SHA256 hashes, duration, and measured loudness (integrated LUFS, true peak dB, and LRA).
- **Cache**: Assets are saved to `.audio-library/` inside the active videos directory. By default this is `videos/.audio-library/`; setting `AIDEOS_VIDEOS_DIR` moves the cache with personal video packages.
- **Serving**: The editor's `/videos/*` middleware can serve files from the active videos directory. Remotion's public path reaches the default `videos/` directory through `public/videos`; when `AIDEOS_VIDEOS_DIR` points elsewhere, the render staging directory includes video packages but not the separate audio cache. `listVideoPackages()` skips the hidden cache directory.
- **Git Ignore**: Git ignores `*.mp3`, `*.wav`, `*.ogg`, and the `videos/.audio-library/` directory.
