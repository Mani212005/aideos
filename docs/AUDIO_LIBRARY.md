<!-- File Description: Documentation for the audio library manifest, caching, and aideos audio CLI commands. -->

# Audio Library and Management Commands

Aideos uses a committed, hash-locked audio library manifest (`audio/library.json`) for background music and sound effects. Audio files are never committed to git; assets are fetched on demand from source URLs into a local shared cache, and the manifest records each item's license and attribution details. The current catalog includes Mixkit music and sound effects, plus sound effects from Freesound and Kenney. Music must not require credit; sound effects are intended as subtle accents.

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
- Exits with code 1 when manual items still need importing.

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

To add a manually downloaded YouTube Audio Library track, first add its complete metadata to `audio/library.json` with `url: null`, including the expected SHA256, byte count, license details, duration, loudness, roles, moods, energy, and content ID risk. Choose a music license that does not require credit. Then import the file using its manifest ID. `aideos audio verify` checks it against the same hash lock.

## 2. Soundtrack Mixing

`Film.soundtrack` is mixed by the shared `src/dl/Soundtrack.tsx` component in both Studio preview and rendered output. Its section and mix fields are defined in [`src/dl/schema.ts`](../src/dl/schema.ts); the browser-safe section mixer is `src/dl/audio/sectionMixer.ts`, and backend save paths record speech activity through `backend/soundtrack.ts`.

- Library music is normalized to the configured target (default -16 LUFS) using each manifest item's measured integrated loudness, then applies the section volume and mono playback correction.
- Sections overlap at chapter cuts with equal-power fades centered on the cut: 3 seconds for Long and 1.5 seconds for Reel. The final section extends through the end card and starts at the source offset that places its ending at the delivery end. If the track is too short, playback uses its available tail and a fade of up to 1.5 seconds. Sources are never looped.
- Backend saves measure narration RMS in 10 ms windows, record intervals above -40 dB, merge gaps shorter than 0.6 seconds, and cache the result against the narration source and edit timing. The browser mixer uses those recorded intervals to apply the configured music levels: -18 dB during speech, -10 dB in pauses, and -8 dB in music-only moments. It starts ducking up to 0.25 seconds before speech and releases over 0.6 seconds.
- Library sound effects play at their recorded timeline positions. Their loudness is normalized before `gainDb` and `volume`; hits and whooshes are capped at least 8 dB below narration peak, and UI effects at least 14 dB below.
- Legacy music, audio, and SFX continue through the legacy playback path when they are normalized into a one-section soundtrack. A film without library-backed soundtrack items keeps its existing audio behavior.

The mixer behavior is covered by the D6 golden soundtrack check in `backend/soundtrack.golden.test.ts`.

### Design soundtrack authoring

The optional `soundtrack` block in `design/design.json` authors `sections` of library music and `sfx` effects. Each section has a role, library item ID, and cue-based `start` and `end`; effects have an item ID and cue-based `at`. Optional section offsets and volume, plus effect gain, volume, and event labels, are supported by the design schema. The design brief's Sound section is generated from the curated audio library and gives agents the available items and authoring rules.

`aideos design build` resolves those cues against measured narration. It writes the long soundtrack to `film.json`; when a soundtrack is configured and a derived reel exists, it resolves the same authored cues against reel timing and writes the reel soundtrack separately. The resolver applies 3-second long and 1.5-second reel crossfades, back-times a final/outro section to the delivery end, binds effects to visual events, and records the library manifest hash and credits. Build output includes `renders/description-credits.txt` for the video description.

`aideos design check` enforces the D6 soundtrack rules: library item existence and no-credit licensing; music sections cover the full delivery without gaps or overlaps and fit their source tracks; section transitions land only at chapter cuts; crossfades match the format; effects match a visual event within +/- 2 frames; effect density is capped at one per 8 seconds for long or one per 5 seconds for reel, with no non-tick pair closer than 0.5 seconds and at most four effect families; reel soundtracks use at most two tracks; and tracks with LRA above 10 are restricted to payoff or outro roles. Regression coverage is in `backend/designCheck/designCheck.test.ts` under D6 cases.

## 3. Storage and Cache Layout

- **Manifest**: `audio/library.json` (schema `aideos.audio-library/1`) holds IDs, metadata, source URLs, licenses, SHA256 hashes, duration, and measured loudness (integrated LUFS, true peak dB, and LRA).
- **Cache**: Assets are saved to `.audio-library/` inside the active videos directory. By default this is `videos/.audio-library/`; setting `AIDEOS_VIDEOS_DIR` moves the cache with personal video packages.
- **Serving**: The editor's `/videos/*` middleware can serve files from the active videos directory. Remotion's public path reaches the default `videos/` directory through `public/videos`; when `AIDEOS_VIDEOS_DIR` points elsewhere, the render staging directory includes video packages but not the separate audio cache. `listVideoPackages()` skips the hidden cache directory.
- **Git Ignore**: Git ignores `*.mp3`, `*.wav`, `*.ogg`, and the `videos/.audio-library/` directory.
