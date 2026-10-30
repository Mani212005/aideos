<!-- File Description: Local stable and updating channels, full acceptance promotion, setup, film copying and rollback. -->

# Local releases

Stable is a separate Git clone with its own dependencies, videos, audio cache and runtime data.
Updating `main` cannot migrate or change stable's films. This is a local Mac workflow; there is no
hosted deployment. Stop each channel's running editor before installing dependencies or changing
its revision. Keep independent backups of valuable film packages.

Once setup is applied, `aideos` opens stable and `aideos-dev` opens the updating clone.
`aideos-stable` is an additional stable alias, including the film-copy command. Until then the
existing `aideos` link stays in place and announces DEV. These installed channel launchers pin
their checkout even when invoked from inside the other checkout.

## How do I know which one I am in?

- Every CLI invocation prints a channel banner to stderr. Stable is green:
  `AIDEOS STABLE v1.0.0 (commit abc1234)`. Dev is orange: `AIDEOS DEV main@abc1234`, with
  `+ UNCOMMITTED CHANGES` when dirty, and a count of commits ahead of stable when its ref is known.
  `NO_COLOR=1` removes the color and preserves the words.
- `aideos version` (or `--version`) prints the channel, release tag and commit. `aideos which`
  prints its channel and absolute checkout path. The same commands work with `aideos-dev`.
- Studio has a persistent colored badge and 3-pixel top strip, a matching favicon, and a tab title
  beginning `[STABLE v1.0.0]` or `[DEV]`. Hover the badge to see the commit and checkout.
- Editor ports default to 3002 for stable and 3001 for dev. Remotion Studio defaults to 3102 and
  3101 respectively. Busy ports fail instead of silently switching channels. `aideos exit` stops
  only its channel's editor, after checking the server's working directory.

Identity is derived from Git. Only a clean checkout on branch `stable` whose HEAD is exactly a
`vX.Y.Z` tag is STABLE. A detached tag, dirty stable checkout, ordinary branch or untagged commit
is DEV. There is no environment flag to claim STABLE. Restart an editor after a branch change;
the badge refreshes Git identity while open, but a running server keeps its original port.

## Promote a release

Use the updating clone on a clean `main` exactly matching fetched `origin/main`. Commit and push
changes through the normal PR process first. Never run promotion from a feature branch. The first
release is `1.0.0`; subsequent versions must be the next patch, next minor, or next major relative
to the highest existing release tag. Existing tags are never overwritten.

Prepare a real complete narrated, designed and scored film package using the regular production
pipeline. It needs `film.json`, `script.md`, `voiceover.wav`, design/look inputs and all its local
assets. Packages must contain regular files and directories, without symlinks. Choose a full film
that exercises the changes being released, not a short excerpt or a tone-only test fixture.

```sh
npm run release -- 1.0.0 --acceptance /absolute/path/to/prepared-film --dry-run
# After inspecting the dry run, run the same acceptance gates for the real promotion:
npm run release -- 1.0.0 --acceptance /absolute/path/to/prepared-film
```

The command fetches refs and checks version/fast-forward eligibility, then:

1. Creates a private temporary videos directory and prints its retained evidence directory.
2. Runs the full `npm run ci` PR check set, including its platform-specific coverage notices.
3. Copies the selected film package into that temporary directory. It downloads hash-locked music
   into that directory's private audio cache. Source films and recordings are never rewritten.
4. Runs `runProduction` with both formats, no frame window, and forced render and verify stages.
   Earlier stages resume when valid. Narration uses Mac `say` (Kokoro on other platforms). If the
   pipeline needs a look, design or reel cut, the release stops: prepare the package with the
   printed next steps before retrying. Missing music in either format or production warnings block
   promotion. Music download, renderer or verification failures also block it.
5. Prints the complete MP4 paths and durations, runs measured review for both formats, and runs
   Gemini video review. These must pass. Reports remain beside the temporary rendered package;
   `production.json` records the run. Review tools require their normal local dependencies/login.
6. Waits for the captain to watch **both complete outputs with sound**, then type exactly
   `WATCHED AND APPROVE v1.0.0` in an interactive terminal. There is no automatic approval option;
   pipes are refused. Dry runs also require this watch confirmation.
7. Rechecks that main and stable have not changed during the watch, creates the annotated release
   tag, advances local stable only by fast-forward, and atomically pushes tag and stable to origin.
   The remote must support atomic push. No force-push is used.
8. Fetches and fast-forwards the configured stable clone to that tag and runs its own `npm ci`.

`--dry-run` performs the same checks, production, reviews and typed watch gate. It prints the Git
and update plan but never tags, moves stable, pushes or updates the stable checkout. Fetching refs,
generated render modules, CI artifacts and retained temporary acceptance outputs are expected.
Acceptance can take many minutes. Never run another renderer or fixture suite concurrently in the
same checkout because they share the generated active-film module.

On the first release there is no stable clone to update. The command publishes the accepted tag
and stable branch, then prints the setup instruction below. If a configured stable clone is missing,
dirty, on another branch, linked to a shared Git directory, or ahead of the candidate, promotion
stops. `--stable-path /path` can select an existing independent stable clone for one promotion.

If atomic push fails, local tag/stable may already exist but nothing was partially published.
Do not retry blindly or overwrite the tag. Inspect `git show vX.Y.Z` and `git ls-remote origin`,
resolve the cause, and either push those already approved refs atomically or retain them and select
the next version. If only the local install fails after push, the release remains published; fetch
the accepted tag into stable, `git merge --ff-only vX.Y.Z`, and rerun `npm ci` there.

## First setup

Run from the updating clone after the first approved release has been published:

```sh
npm run release:setup -- --path "$HOME/aideos-stable"
# Prints the clone/install plan and the exact ln -sfn commands without changing anything.
npm run release:setup -- --path "$HOME/aideos-stable" --apply
```

The default path is `~/aideos-stable`; `--bin-dir` defaults to `~/.local/bin`. Setup refuses an
existing non-empty path, a linked destination, or a regular file at a launcher location. `--apply`
requires typing `SET UP STABLE AND SWITCH AIDEOS`. There is no implicit change to the existing
`aideos` link. `--dry-run` explicitly selects the same plan-only behavior as omitting `--apply`.

Setup clones origin's `stable` branch with no shared Git objects, installs dependencies, creates
private `videos/` and `data/`, and installs these links:

```sh
ln -sfn "$HOME/aideos-stable/bin/aideos-stable" "$HOME/.local/bin/aideos"
ln -sfn "$HOME/aideos-stable/bin/aideos-stable" "$HOME/.local/bin/aideos-stable"
ln -sfn /absolute/updating/checkout/bin/aideos-dev "$HOME/.local/bin/aideos-dev"
```

The clone starts with no personal films or runtime data (the tracked videos README remains).
No `.env`, voice recording or personal audio cache is copied. The stable launcher pins
`AIDEOS_PROJECT_ROOT` and `AIDEOS_VIDEOS_DIR` to the stable clone even if the shell inherited an
updating path. Git-local settings record the stable path in the updating clone and the source
videos path in stable. If the updating videos directory was customized, run setup with that same
`AIDEOS_VIDEOS_DIR`. Keep `~/.local/bin` in PATH. Use separate terminals to run both editors.

## Copy a film into stable

```sh
aideos-stable copy-film my-film --dry-run
aideos-stable copy-film my-film
aideos-stable copy-film my-film --overwrite
```

This copies from the source videos directory recorded during setup into stable's own videos
directory. It never moves or deletes anything. A duplicate slug is refused by default; `--overwrite`
replaces matching files and leaves destination-only files intact. Source files remain unchanged.
Symlinks and traversal slugs are rejected. The operation copies only the package, so externally
referenced media and the audio-library cache need their own independent copies or downloads using
stable's audio commands. A newer package format may be unreadable by an older release; copy a
compatible package or retain it in dev until promotion. Copying is explicit and never part of update.

## Roll back

Rollback is an explicit local operation, separate from the forward-only release command. Stop
stable, record its current release, and choose an earlier approved tag. To preserve independent
videos and data, change code only; never reset or clean those directories:

```sh
git -C "$HOME/aideos-stable" fetch --tags origin
git -C "$HOME/aideos-stable" switch --detach v1.0.0
npm --prefix "$HOME/aideos-stable" ci
```

A detached rollback deliberately shows DEV under the channel identity rule. To mark this local
rollback STABLE after checking it, move **only this clone's local branch** to the selected tag:

```sh
git -C "$HOME/aideos-stable" branch -f stable v1.0.0
git -C "$HOME/aideos-stable" switch stable
```

Do not push a rollback or rewrite origin/stable. The next accepted promotion can fast-forward the
local clone from that earlier tag. Code rollback does not undo data migrations; if a promoted version
changed stable data, restore a compatible backup before reopening an older version.
