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

`Film.soundtrack` is the recorded mix manifest. [`src/dl/schema.ts`](../src/dl/schema.ts) defines its library hash, optional default-score format, music sections, measured speech intervals, narration peak, mix levels, sound effects, and credits. The shared [`src/dl/Soundtrack.tsx`](../src/dl/Soundtrack.tsx) component mixes the film in both Studio preview and rendered output. Library-backed sections use the browser-safe [`sectionMixer.ts`](../src/dl/audio/sectionMixer.ts); legacy file paths keep the legacy playback path.

### Library identity and legacy films

Each library-backed section and effect records an item ID; a SHA256 can also be recorded to lock the asset identity. When present, the mixer checks that hash against `audio/library.json` and rejects a changed hash; unknown items are rejected. `aideos audio fetch` downloads listed assets into the active audio cache and checks their hashes. `aideos audio verify` checks the full cache against the manifest. `aideos audio import <id> <file>` copies a manual asset only when it matches the hash already recorded for that item.

`normalizeFilmSoundtrack` maps legacy `film.music` or `film.audio` into a single file-backed section. The section spans the shot duration, carries the legacy volume and ducking setting, and uses `film.audio.trimBefore` as its source offset. It maps legacy `film.sfx` entries into file-backed effects. A soundtrack with authored sections takes precedence over those legacy fields. A path-only soundtrack stays on the legacy playback path, while any section or effect with a library identity uses the section mixer.

### Mixing and speech pauses

The section mixer uses each manifest item's integrated loudness to set the gain toward `targetLufs`, which defaults to -16 LUFS. It then applies the section volume and a mono-to-stereo correction where needed. It does not analyze the music file during playback.

At chapter cuts, sections overlap with equal-power fades centered on the cut. Long uses a 3-second crossfade and Reel uses 1.5 seconds. The last section extends through the end card and is back-timed from the end of its source. Sources are never looped. The design check rejects sections whose full frame-rounded source span does not fit the track.

Narration assembly inserts a default 900 ms gap before a segment that starts a new chapter. This chapter breath gives a soundtrack crossfade room to land between spoken lines. Separately, `backend/soundtrack.ts` measures narration audio in 10 ms RMS windows. It records windows above -40 dB, maps them through clip timing and speed, and merges intervals separated by less than 0.6 seconds. The saved fingerprint covers narration bytes and clip edits, so a change triggers new measurements. Ducking uses these measured intervals, not text timing or inferred breaths.

The default music levels are -18 dB during measured speech, -10 dB in pauses, and -8 dB in music-only time. Ducking starts up to 0.25 seconds before speech and releases over 0.6 seconds. The transition between story and end-card music-only levels is also ramped. Library effects use manifest loudness, effect gain, and volume; their peaks are capped at least 8 dB below the measured narration peak, or 14 dB for UI effects.

### Design soundtrack authoring and checks

The optional `soundtrack` block in `design/design.json` authors music `sections` and sound-effect `sfx`. A section names its role, library item, cue-based `start` and `end`, and optional offset and volume. An effect names its item, cue-based `at`, optional gain and volume, and optional visual event. Design build resolves cues against measured narration, records the audio-library manifest hash, and derives credits. A soundtrack configured in the design is resolved separately against Long and Reel timing. Required credits from the delivered cuts are written to `renders/description-credits.txt`.

`aideos design check` checks that library items exist, music and effects do not require attribution, track roles match both their library metadata and story position, sections cover the full delivery without gaps or overlaps, tracks fit their frame-rounded source spans, transitions land on chapter cuts, and crossfades match the output format. It also checks that effects land within two frames of a visual event, limits their average density to one per eight seconds for Long or one per five seconds for Reel, rejects non-tick pairs closer than 0.5 seconds, limits a soundtrack to four effect families, caps Reel at two music tracks, and allows LRA above 10 only for payoff or outro sections.

When a film has no explicit music, audio, SFX, or authored soundtrack block, design delivery assigns a deterministic default score from the hash-locked library, seeded by film ID, role, section, and delivery format. For a long film with chapter cuts, the score uses the opening chapter as hook, middle chapters as explain, and the final chapter plus end card as payoff; it may split the explanation at a chapter cut when track length requires it. Without chapter cuts, the scorer uses the story as hook and the end card as payoff, with that single-chapter transition allowed by design check. A reel uses one reel-role track when an eligible track spans the delivery; otherwise, if no eligible full-span track exists, it uses two reel-role sections joined at a chapter cut. Eligible tracks must require no credit, support the selected role, meet the LRA limit for that role, and cover their full frame-rounded source span. The final section is back-timed through the end card. If no eligible arrangement fits without looping, scoring fails when all library assets are verified. If suitable tracks are missing or invalid in the cache, default music is omitted with a warning and the film remains unscored. Explicit owner audio, including legacy SFX, remains authoritative and is preserved. Rebuilding a derived reel recomputes a default score for reel timing; it does not reuse the long score.

`aideos design check` enforces the D6 soundtrack rules: library item existence and no-credit licensing; supported and story-position-correct music roles; sections covering the full delivery without gaps or overlaps and fitting their frame-rounded source spans; section transitions landing only at chapter cuts, except the single-chapter story-to-end-card closing transition; crossfades matching the format; effects matching a visual event within +/- 2 frames; effect density capped at one per 8 seconds for long or one per 5 seconds for reel, with no non-tick pair closer than 0.5 seconds and at most four effect families; reel soundtracks using at most two tracks, with a two-section reel-role exception only for contiguous, chapter-aligned coverage when no eligible full-span reel track exists; and tracks with LRA above 10 restricted to payoff or outro roles. Regression coverage is in `backend/designCheck/designCheck.test.ts` under D6 cases and `backend/designCheck/soundtrackReel.test.ts` for the reel fallback.

With a custom `AIDEOS_VIDEOS_DIR`, render staging can omit the separate `.audio-library` cache, leaving cached library audio unavailable to renders. The master stage measures delivered loudness and true peak, then applies gain toward -16 LUFS. If the gain would exceed -1 dBTP, it limits and remeasures the encoded AAC output, adjusting gain for up to five attempts. Without limiting, it applies one gain correction. The limiter does not account for encoded-peak overshoot. If a render is silent or loudness cannot be measured, mastering warns and retains the original render.

### Studio soundtrack controls

In Studio's Edit stage, the Music lane shows each section's role and track title. The Sound effects lane shows event markers. Double-click a music section to open the Mix panel. You can audition a cached track, swap it for another library item with the same role, set music and effects levels, and read soundtrack credits. A swap fetches and verifies the selected item before the edit is committed. Each accepted edit creates one undo step.

Studio edits target the Long film. The server rebuilds and checks the soundtrack before committing a swap or level change. Owner saves also check soundtrack validity. Moving a section off a chapter cut or an effect away from its event is rejected. Soundtrack sections and effect clips cannot be split in the timeline. When `design.json` has an authored soundtrack, a reel build resolves those cues against Reel timing. Without an authored design soundtrack, an existing `film.soundtrack` carries forward; a generated default score is recomputed for Reel timing.

## 3. Storage and Cache Layout

- **Manifest**: `audio/library.json` (schema `aideos.audio-library/1`) holds IDs, metadata, source URLs, licenses, SHA256 hashes, duration, and measured loudness (integrated LUFS, true peak dB, and LRA).
- **Cache**: Assets are saved to `.audio-library/` inside the active videos directory. By default this is `videos/.audio-library/`; setting `AIDEOS_VIDEOS_DIR` moves the cache with personal video packages.
- **Serving**: The editor's `/videos/*` middleware serves files from the active videos directory, including the audio cache. Render paths stage the active videos directory under Remotion's `public/videos`, including `.audio-library`, when `AIDEOS_VIDEOS_DIR` points elsewhere. `listVideoPackages()` skips the hidden cache directory.
- **Git Ignore**: Git ignores `*.mp3`, `*.wav`, `*.ogg`, and the `videos/.audio-library/` directory.
