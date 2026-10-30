/**
 * File Description: Local release promotion, isolated stable clone setup and explicit film copying.
 * Inputs and outputs: release/setup/copy-film arguments -> checked renders, confirmed Git promotion or isolated clone/copy.
 * Used by: npm run release, npm run release:setup and bin/aideos-stable.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { git, optionalGit, releaseChannel } from "../backend/releaseChannel";

const ROOT = path.resolve(__dirname, "..");
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Stops on a failed precondition before any promotion side effect. */
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Runs an existing tool directly, preserving its output and failure status. */
function run(command: string, args: string[], cwd = ROOT, env = process.env): void {
  console.log(`> ${command} ${args.map(quote).join(" ")}`);
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

/** Quotes a path for the exact shell commands printed in setup plans. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Requires an exact typed response from a terminal, with no automatic approval flag. */
async function confirm(phrase: string): Promise<void> {
  requireThat(process.stdin.isTTY && process.stdout.isTTY, "Approval requires an interactive terminal; piped approval is refused.");
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { requireThat(await input.question(`Type ${quote(phrase)} to continue: `) === phrase, "Confirmation did not match; nothing promoted."); }
  finally { input.close(); }
}

/** Reads a local channel setting without importing or sharing another checkout's data. */
function setting(root: string, name: string): string {
  return optionalGit(root, ["config", "--local", "--get", `aideos.${name}`]);
}

/** Validates the next patch, minor or major release, with 1.0.0 as the first release. */
function validateVersion(version: string): string {
  requireThat(VERSION.test(version), "Version must be X.Y.Z with no prefix, leading zeros or prerelease suffix.");
  const releases = git(ROOT, ["tag", "--list", "v*", "--sort=-version:refname"]).split("\n").filter((tag) => VERSION.test(tag.slice(1)));
  const previous = releases[0];
  const [major, minor, patch] = (previous?.slice(1) ?? "0.0.0").split(".").map(Number);
  const next = previous ? [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`] : ["1.0.0"];
  requireThat(next.includes(version), `Next release must be one of ${next.join(", ")}; latest tag is ${previous || "none"}.`);
  requireThat(!optionalGit(ROOT, ["rev-parse", "--verify", `refs/tags/v${version}`]), `Tag v${version} already exists.`);
  return `v${version}`;
}

/** Checks clean, exact origin/main state and fetches remote refs without moving any local branch. */
function preflightMain(): string {
  requireThat(git(ROOT, ["symbolic-ref", "--short", "HEAD"]) === "main", "Release requires the main branch.");
  requireThat(!git(ROOT, ["status", "--porcelain", "--untracked-files=all"]), "Release requires a clean checkout, including untracked files.");
  run("git", ["fetch", "--prune", "--tags", "origin"]);
  const head = git(ROOT, ["rev-parse", "HEAD"]);
  requireThat(head === git(ROOT, ["rev-parse", "refs/remotes/origin/main"]), "main must exactly match fetched origin/main; update it before releasing.");
  const stable = optionalGit(ROOT, ["rev-parse", "--verify", "refs/remotes/origin/stable"]);
  const localStable = optionalGit(ROOT, ["rev-parse", "--verify", "refs/heads/stable"]);
  for (const ref of [stable, localStable].filter(Boolean)) git(ROOT, ["merge-base", "--is-ancestor", ref, head]);
  return head;
}

/** Refuses links anywhere in a package so copies cannot retain a shared data dependency. */
function checkCopyTree(dir: string): void {
  const stat = fs.lstatSync(dir);
  requireThat(!stat.isSymbolicLink(), `Symlinks are not self-contained: ${dir}`);
  requireThat(stat.isDirectory() || stat.isFile(), `Unsupported file type: ${dir}`);
  if (stat.isDirectory()) for (const name of fs.readdirSync(dir)) checkCopyTree(path.join(dir, name));
}

/** Builds an isolated environment for a channel's own videos and runtime data. */
function isolatedEnv(root: string, videos: string): NodeJS.ProcessEnv {
  return { ...process.env, AIDEOS_PROJECT_ROOT: root, AIDEOS_VIDEOS_DIR: videos };
}

/** Checks a configured stable clone before promotion can touch refs or its dependencies. */
function checkStableClone(dir: string, head: string): void {
  requireThat(fs.realpathSync(dir) !== fs.realpathSync(ROOT), "Stable must be a separate clone.");
  requireThat(fs.lstatSync(path.join(dir, ".git")).isDirectory(), "Stable must be a separate clone, not a linked worktree.");
  requireThat(git(dir, ["rev-parse", "--show-toplevel"]) === fs.realpathSync(dir), "Stable path must be a clone root.");
  requireThat(fs.realpathSync(git(dir, ["rev-parse", "--absolute-git-dir"])) !== fs.realpathSync(git(ROOT, ["rev-parse", "--absolute-git-dir"])), "Stable cannot share the updating repository's Git directory.");
  requireThat(git(dir, ["symbolic-ref", "--short", "HEAD"]) === "stable", "Stable checkout must be on stable.");
  requireThat(!git(dir, ["status", "--porcelain", "--untracked-files=all"]), "Stable checkout has uncommitted changes.");
  requireThat(git(dir, ["remote", "get-url", "origin"]) === git(ROOT, ["remote", "get-url", "origin"]), "Stable and updating origins differ.");
  const stableHead = git(dir, ["rev-parse", "HEAD"]);
  git(ROOT, ["merge-base", "--is-ancestor", stableHead, head]);
  for (const name of ["videos", "data", "node_modules"]) {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) requireThat(!fs.lstatSync(target).isSymbolicLink(), `Stable ${name} must not be shared through a symlink.`);
  }
}

/** Runs full CI and a complete, music-backed production on a private copy of the chosen film. */
async function acceptance(source: string, evidence: string): Promise<void> {
  const videos = path.join(evidence, "videos");
  fs.mkdirSync(videos);
  process.env.AIDEOS_PROJECT_ROOT = ROOT;
  process.env.AIDEOS_VIDEOS_DIR = videos;
  process.env.AIDEOS_CI_ARTIFACTS = path.join(evidence, "ci");
  run("npm", ["run", "ci"]);
  const { getVideosDir } = await import("../src/dl/videoPackageLoader");
  const { parseFilm } = await import("../src/dl/schema");
  const { runProduction } = await import("../backend/pipeline/run");
  const { readFilm } = await import("../backend/pipeline/filmStore");
  const { fetchAudioItem, loadAudioLibrary } = await import("../backend/audioLibrary/library");
  for (const item of loadAudioLibrary().items.filter((item) => item.kind === "music" && item.url)) {
    await fetchAudioItem(item);
  }
  checkCopyTree(source);
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(source, "film.json"), "utf8")));
  const pkg = path.join(getVideosDir(), film.id);
  fs.cpSync(source, pkg, { recursive: true, errorOnExist: true, force: false,
    filter: (file) => !["renders", "review", "gemini-review"].includes(path.basename(file)) });
  const script = fs.readFileSync(path.join(pkg, "script.md"), "utf8");
  requireThat(fs.existsSync(path.join(pkg, "voiceover.wav")), "Acceptance needs a real narrated package, including voiceover.wav.");
  const result = await runProduction({
    slug: film.id, title: film.title, script, formats: ["long", "reel"],
    resume: true, force: ["render", "verify"], broll: false, skipAgent: true,
    design: "inline", deviceCaller: null, renderConcurrency: 2,
    ttsBackend: process.platform === "darwin" ? "say" : "kokoro",
    ...(process.env.AIDEOS_BROWSER_EXECUTABLE ? { browserExecutable: process.env.AIDEOS_BROWSER_EXECUTABLE } : {}),
  }, (event) => console.log(`[acceptance] ${event.stage}: ${event.message}`));
  fs.writeFileSync(path.join(evidence, "production.json"), JSON.stringify(result, null, 2));
  requireThat(result.status === "completed", `Acceptance stopped at ${result.status}: ${result.nextSteps?.join("\n") || "see production.json"}. Prepare the film before retrying.`);
  requireThat(result.outputs.length === 2 && result.outputs.some((output) => output.format === "long") && result.outputs.some((output) => output.format === "reel"), "Both full formats are required.");
  const produced = readFilm(film.id);
  const reelPath = path.join(pkg, "reel/film.json");
  const reel = fs.existsSync(reelPath) ? parseFilm(JSON.parse(fs.readFileSync(reelPath, "utf8"))) : produced;
  for (const delivered of [produced, reel]) requireThat(delivered?.soundtrack?.sections.length || delivered?.music, "Both acceptance formats must have music. Prepare a scored package before release.");
  requireThat(result.warnings.length === 0, `Acceptance warnings block release:\n${result.warnings.join("\n")}`);
  for (const output of result.outputs) console.log(`WATCH ${output.format}: ${output.path} (${output.durationSec.toFixed(2)} seconds)`);
  run(path.join(ROOT, "node_modules/.bin/tsx"), ["backend/cli.ts", "review", film.id]);
  for (const output of result.outputs) run(path.join(ROOT, "node_modules/.bin/tsx"), ["backend/cli.ts", "gemini-review", output.path]);
}

/** Gates promotion on current main, full checks, complete renders and explicit captain watch approval. */
async function release(version: string, options: { acceptance: string; dryRun?: boolean; stablePath?: string }): Promise<void> {
  const head = preflightMain();
  const tag = validateVersion(version);
  const stableDir = path.resolve(options.stablePath || setting(ROOT, "stablePath") || path.join(os.homedir(), "aideos-stable"));
  const hasStable = fs.existsSync(stableDir);
  if (hasStable) checkStableClone(stableDir, head);
  else requireThat(!options.stablePath && !setting(ROOT, "stablePath"), "Configured stable clone is missing; restore it before promotion.");
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), `aideos-release-${version}-`));
  console.log(`Acceptance evidence (retained): ${evidence}`);
  await acceptance(path.resolve(options.acceptance), evidence);
  await confirm(`WATCHED AND APPROVE ${tag}`);
  requireThat(preflightMain() === head, "main changed during acceptance; rerun the release.");
  validateVersion(version);
  if (hasStable) checkStableClone(stableDir, head);
  const actions = [
    `git tag -a ${tag} ${head} -m ${quote(`Aideos ${tag}: full acceptance watched and approved`)}`,
    optionalGit(ROOT, ["rev-parse", "--verify", "refs/heads/stable"]) ? `git fetch . ${tag}:refs/heads/stable` : `git branch stable ${tag}`,
    `git push --atomic origin refs/tags/${tag} refs/heads/stable:refs/heads/stable`,
    ...(hasStable ? [`git -C ${quote(stableDir)} fetch --tags origin`, `git -C ${quote(stableDir)} merge --ff-only ${tag}`, `npm --prefix ${quote(stableDir)} ci`] : ["First release: run npm run release:setup, inspect its plan, then repeat with --apply."]),
  ];
  console.log(`${options.dryRun ? "DRY RUN - would run" : "Promotion plan"}:\n${actions.join("\n")}`);
  if (options.dryRun) return;
  run("git", ["tag", "-a", tag, head, "-m", `Aideos ${tag}: full acceptance watched and approved`]);
  if (optionalGit(ROOT, ["rev-parse", "--verify", "refs/heads/stable"])) run("git", ["fetch", ".", `${tag}:refs/heads/stable`]);
  else run("git", ["branch", "stable", tag]);
  run("git", ["push", "--atomic", "origin", `refs/tags/${tag}`, "refs/heads/stable:refs/heads/stable"]);
  if (hasStable) {
    run("git", ["fetch", "--tags", "origin"], stableDir);
    run("git", ["merge", "--ff-only", tag], stableDir);
    run("npm", ["ci"], stableDir, isolatedEnv(stableDir, path.join(stableDir, "videos")));
  }
}

/** Prints setup's exact commands and applies them only after explicit typed confirmation. */
async function setup(options: { path: string; binDir: string; apply?: boolean; dryRun?: boolean }): Promise<void> {
  requireThat(!(options.apply && options.dryRun), "Choose --apply or --dry-run.");
  const dir = path.resolve(options.path);
  const binDir = path.resolve(options.binDir);
  requireThat(!fs.existsSync(dir) || (!fs.lstatSync(dir).isSymbolicLink() && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0), `Refusing non-empty or linked destination: ${dir}`);
  const origin = git(ROOT, ["remote", "get-url", "origin"]);
  const links = [["aideos", path.join(dir, "bin/aideos-stable")], ["aideos-stable", path.join(dir, "bin/aideos-stable")], ["aideos-dev", path.join(ROOT, "bin/aideos-dev")]];
  console.log(`Setup plan:\ngit clone --no-hardlinks --branch stable ${quote(origin)} ${quote(dir)}\nnpm --prefix ${quote(dir)} ci\nmkdir -p ${quote(binDir)}`);
  for (const [name, target] of links) console.log(`ln -sfn ${quote(target)} ${quote(path.join(binDir, name))}`);
  console.log(`Private videos: ${path.join(dir, "videos")}\nPrivate data: ${path.join(dir, "data")}\nAdd ${quote(binDir)} to PATH. Stable port 3002; dev port 3001.`);
  if (!options.apply) return;
  for (const [name] of links) {
    const link = path.join(binDir, name);
    if (fs.existsSync(link)) requireThat(fs.lstatSync(link).isSymbolicLink(), `Refusing to replace a regular file: ${link}`);
  }
  const refs = git(ROOT, ["ls-remote", "--heads", "--tags", "origin"]);
  const stable = refs.split("\n").find((line) => line.endsWith("\trefs/heads/stable"))?.split("\t")[0];
  requireThat(stable && refs.split("\n").some((line) => line.startsWith(`${stable}\trefs/tags/v`) && line.endsWith("^{}")), "Publish the first annotated release and stable branch before setup.");
  await confirm("SET UP STABLE AND SWITCH AIDEOS");
  run("git", ["clone", "--no-hardlinks", "--branch", "stable", origin, dir]);
  requireThat(releaseChannel(dir).channel === "stable", "Remote stable is not exactly a release tag.");
  for (const name of ["videos", "data"]) fs.mkdirSync(path.join(dir, name), { recursive: true });
  run("npm", ["ci"], dir, isolatedEnv(dir, path.join(dir, "videos")));
  git(dir, ["config", "--local", "aideos.updatingPath", ROOT]);
  const { getVideosDir } = await import("../src/dl/videoPackageLoader");
  git(dir, ["config", "--local", "aideos.sourceVideos", getVideosDir()]);
  git(ROOT, ["config", "--local", "aideos.stablePath", dir]);
  fs.mkdirSync(binDir, { recursive: true });
  for (const [name, target] of links) run("ln", ["-sfn", target, path.join(binDir, name)]);
}

/** Copies one package without removing source files or deleting existing destination files. */
async function copyFilm(slug: string, options: { overwrite?: boolean; dryRun?: boolean }): Promise<void> {
  requireThat(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), "Film slug must contain lowercase letters, digits and single hyphens.");
  const sourceVideos = setting(ROOT, "sourceVideos");
  requireThat(sourceVideos && setting(ROOT, "updatingPath"), "Run copy-film from a clone created by release:setup.");
  const { getVideosDir } = await import("../src/dl/videoPackageLoader");
  const source = path.join(sourceVideos, slug);
  const target = path.join(getVideosDir(), slug);
  requireThat(fs.realpathSync(sourceVideos) !== fs.realpathSync(getVideosDir()), "Source and stable videos must differ.");
  requireThat(fs.existsSync(path.join(source, "film.json")), `Film package not found: ${source}`);
  checkCopyTree(source);
  requireThat(!fs.existsSync(target) || options.overwrite, `Film ${slug} already exists; use --overwrite to replace matching files.`);
  if (fs.existsSync(target)) checkCopyTree(target);
  console.log(`${options.dryRun ? "DRY RUN - would copy" : "Copy"}: ${source} -> ${target}`);
  if (!options.dryRun) fs.cpSync(source, target, { recursive: true, force: Boolean(options.overwrite), errorOnExist: !options.overwrite });
}

const program = new Command().description("Local stable release tools; see docs/RELEASES.md");
program.command("release <version>").requiredOption("--acceptance <package-dir>", "prepared full narrated and scored film package")
  .option("--stable-path <path>", "existing stable clone override").option("--dry-run", "run all acceptance gates without promotion")
  .action(release);
program.command("setup").option("--path <path>", "new stable clone", path.join(os.homedir(), "aideos-stable"))
  .option("--bin-dir <path>", "launcher directory", path.join(os.homedir(), ".local/bin"))
  .option("--apply", "confirm and apply the printed plan").option("--dry-run", "print setup plan only").action(setup);
program.command("copy-film <slug>").option("--overwrite", "replace matching files in an existing package")
  .option("--dry-run", "print without copying").action(copyFilm);
program.parseAsync().catch((error: unknown) => {
  console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
