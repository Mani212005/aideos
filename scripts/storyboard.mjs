/**
 * ---------------------------------------------------------------------------
 * STORYBOARD GENERATOR  (pipeline level 4)
 * ---------------------------------------------------------------------------
 * Reads the episode, renders one real still per scene through Remotion, and
 * writes a Lavish review page built from that same data.
 *
 * Why real stills matter: the previous hand-written storyboard drew CSS
 * approximations of each scene. It depicted the light-theme variant that was
 * never registered as a composition, while the composition that actually
 * rendered was dark. Approving it told you nothing. Because every panel here is
 * a frame straight out of the renderer, the storyboard cannot disagree with the
 * video — there is only one source of truth.
 *
 *   node scripts/storyboard.mjs [--formats landscape,portrait] [--scale 0.5]
 */

import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import * as esbuild from "esbuild";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".lavish");
const FRAME_DIR = path.join(OUT_DIR, "frames");

const FORMATS = {
  landscape: { id: "Video-Landscape", label: "16:9 Landscape", aspect: "16 / 9" },
  portrait: { id: "Video-Portrait", label: "9:16 Portrait", aspect: "9 / 16" },
  square: { id: "Video-Square", label: "1:1 Square", aspect: "1 / 1" },
};

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};

const wantedFormats = argOf("--formats", "landscape,portrait")
  .split(",")
  .map((f) => f.trim())
  .filter((f) => f in FORMATS);
const scale = Number(argOf("--scale", "0.5"));

/**
 * Loads the episode and palette by transpiling the TypeScript to ESM in a temp
 * file and importing it. Both modules are dependency-free by design, so this
 * needs no browser, no fonts and no React.
 */
const loadPureModule = async (relPath, tmpName) => {
  const tmp = path.join(ROOT, "node_modules", ".cache", tmpName);
  await mkdir(path.dirname(tmp), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, relPath)],
    outfile: tmp,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const mod = await import(`file://${tmp}?t=${Date.now()}`);
  return mod;
};

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Renders the headline markers the way the video does, for faithful review. */
const renderMarkup = (text, accentHex, altHex) =>
  esc(text)
    .split("\n")
    .map((line) =>
      line
        .replace(/\*([^*]+)\*/g, `<em style="color:${accentHex};font-style:normal">$1</em>`)
        .replace(/~([^~]+)~/g, `<em style="color:${altHex};font-style:normal">$1</em>`)
        .replace(/_([^_]+)_/g, '<em class="serif">$1</em>'),
    )
    .join("<br>");

const main = async () => {
  console.log("Loading episode…");
  // Load whichever episode is active rather than a named one. activeEpisode.ts
  // re-exports a pure-data module, so this still needs no browser or fonts.
  const { ACTIVE_EPISODE: episode } = await loadPureModule(
    "src/activeEpisode.ts",
    "storyboard-episode.mjs",
  );
  const palette = await loadPureModule("src/palette.ts", "storyboard-palette.mjs");
  const theme = palette.THEMES[episode.theme];
  // Flattened so the template reads the same way the components do.
  const COLOR = {
    bgDeep: theme.bgDeep, bgLift: theme.bgLift,
    inkHigh: theme.inkHigh, inkMid: theme.inkMid, inkLow: theme.inkLow,
    hairline: theme.hairline, glass: theme.glass,
    green: theme.primary.base, purple: theme.secondary.base,
  };

  const fps = episode.fps;
  const totalSeconds = episode.scenes.reduce((s, sc) => s + sc.duration, 0);

  // Same rule the renderer uses: far enough in that entrances have finished,
  // far enough from the end that nothing has started to exit.
  const posterFrame = (scene) => {
    const total = Math.round(scene.duration * fps);
    return (
      Math.round(scene.start * fps) + Math.min(Math.round(total * 0.72), total - 24)
    );
  };

  await rm(FRAME_DIR, { recursive: true, force: true });
  await mkdir(FRAME_DIR, { recursive: true });

  console.log("Bundling Remotion project (once)…");
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "src", "index.ts"),
    onProgress: () => {},
  });

  // `remotion.config.ts` is a CLI-only file — the Node APIs ignore it entirely,
  // so the ANGLE renderer the WebGL scene needs must be passed explicitly here.
  // Without it Chromium falls back to SwiftShader and three.js cannot get a
  // context at all.
  const chromiumOptions = { gl: "angle" };

  // One browser for every still. Letting each renderStill() launch and tear down
  // its own Chromium is both slow and unreliable with WebGL — it crashed with
  // "browser has disconnected" partway through the batch.
  // `gl` lives under chromiumOptions — passing it at the top level is silently
  // ignored, and the browser comes up on SwiftShader with no usable context.
  const puppeteerInstance = await openBrowser("chrome", { chromiumOptions });

  const shots = {};
  try {
    for (const format of wantedFormats) {
      const { id } = FORMATS[format];
      const composition = await selectComposition({
        serveUrl,
        id,
        chromiumOptions,
        puppeteerInstance,
      });
      shots[format] = {};

      for (const scene of episode.scenes) {
        const frame = posterFrame(scene);
        const file = `${scene.id}-${format}.png`;
        process.stdout.write(`  ${format}/${scene.id} @ frame ${frame}\n`);
        await renderStill({
          serveUrl,
          composition,
          frame,
          scale,
          imageFormat: "png",
          chromiumOptions,
          puppeteerInstance,
          output: path.join(FRAME_DIR, file),
        });
        shots[format][scene.id] = `frames/${file}`;
      }
    }
  } finally {
    await puppeteerInstance.close({ silent: true });
  }

  // Lavish serves the page from .lavish/, so assets must be siblings with
  // relative paths — a leading slash would not resolve.
  if (episode.audio) {
    const src = path.join(ROOT, "public", episode.audio.src);
    if (existsSync(src)) await copyFile(src, path.join(OUT_DIR, episode.audio.src));
  }

  const html = buildHtml({ episode, shots, COLOR, totalSeconds, wantedFormats });
  await writeFile(path.join(OUT_DIR, "storyboard.html"), html, "utf8");
  console.log(`\n✓ .lavish/storyboard.html  (${episode.scenes.length} scenes × ${wantedFormats.length} formats)`);
};

const buildHtml = ({ episode, shots, COLOR, totalSeconds, wantedFormats }) => {
  // Accents are roles; the theme pack resolves them.
  const accentHex = { primary: COLOR.green, secondary: COLOR.purple, neutral: COLOR.inkHigh };
  const altHex = { primary: COLOR.purple, secondary: COLOR.green, neutral: COLOR.purple };

  const sceneCards = episode.scenes
    .map((scene, i) => {
      const end = (scene.start + scene.duration).toFixed(0);
      const tone = accentHex[scene.accent];
      const frames = wantedFormats
        .map(
          (f) => `
        <figure class="shot" style="--aspect:${FORMATS[f].aspect}">
          <img src="${shots[f][scene.id]}" alt="${esc(scene.id)} ${f}" loading="lazy">
          <figcaption>${FORMATS[f].label}</figcaption>
        </figure>`,
        )
        .join("");

      const facts = [
        ["module", scene.visual ?? "type only"],
        ["accent", scene.accent],
        ["state", `${scene.subjectState}${scene.wash ? " (wash)" : ""}`],
        ["camera", `d ${scene.camera.distance} · yaw ${scene.camera.yaw} · pitch ${scene.camera.pitch}`],
      ];

      return `
      <article class="scene" id="scene-${esc(scene.id)}">
        <header class="scene-head">
          <div class="scene-index" style="color:${tone}">${String(i + 1).padStart(2, "0")}</div>
          <div class="scene-titles">
            ${scene.kicker ? `<div class="kicker" style="color:${tone}">${esc(scene.kicker)}</div>` : ""}
            <h3>${renderMarkup(scene.headline, tone, altHex[scene.accent])}</h3>
            ${scene.body ? `<p class="body">${esc(scene.body)}</p>` : ""}
          </div>
          <div class="scene-time">${scene.start}s–${end}s<span>${scene.duration}s</span></div>
        </header>

        <div class="shots">${frames}</div>

        <dl class="facts">
          ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}
        </dl>

        <form class="verdict" data-lavish-question="scene-${esc(scene.id)}"
          onsubmit="submitScene(event, '${esc(scene.id)}')">
          <div class="radios">
            <label><input type="radio" name="v" value="approve" checked> Approve</label>
            <label><input type="radio" name="v" value="revise"> Needs change</label>
            <label><input type="radio" name="v" value="cut"> Cut this scene</label>
          </div>
          <textarea name="note" rows="2" placeholder="What should change? e.g. 'hold this 2s longer', 'leaf is too close', 'rewrite headline'"></textarea>
          <button type="submit">Queue verdict</button>
          <span class="queued" hidden>queued ✓</span>
        </form>
      </article>`;
    })
    .join("");

  const formatChecks = Object.entries(FORMATS)
    .map(
      ([key, f]) => `
      <label class="fmt">
        <input type="checkbox" name="format" value="${f.label}" ${wantedFormats.includes(key) ? "checked" : ""}>
        <span class="fmt-box" style="aspect-ratio:${f.aspect}"></span>
        <span>${f.label}</span>
      </label>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(episode.title)} — Storyboard</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Instrument+Serif:ital@1&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: ${COLOR.bgDeep};
    --lift: ${COLOR.bgLift};
    --ink: ${COLOR.inkHigh};
    --mid: ${COLOR.inkMid};
    --low: ${COLOR.inkLow};
    --green: ${COLOR.green};
    --purple: ${COLOR.purple};
    --hair: ${COLOR.hairline};
    --glass: ${COLOR.glass};
  }
  * { box-sizing: border-box; min-width: 0; }
  body {
    margin: 0; padding: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }
  .serif { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 40px 24px 120px; }

  header.top {
    border-bottom: 1px solid var(--hair);
    padding-bottom: 28px; margin-bottom: 12px;
  }
  .eyebrow {
    font-size: 11px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase;
    color: var(--green); margin-bottom: 14px;
  }
  h1 { font-size: clamp(28px, 4vw, 44px); font-weight: 900; letter-spacing: -.03em; margin: 0 0 10px; line-height: 1.08; }
  .sub { color: var(--mid); font-size: 16px; margin: 0; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  .pill {
    border: 1px solid var(--hair); background: var(--glass);
    border-radius: 99px; padding: 6px 14px; font-size: 12px; font-weight: 600; color: var(--mid);
  }
  .pill b { color: var(--ink); font-weight: 700; }

  .note {
    margin: 28px 0 40px; padding: 16px 18px;
    border-left: 2px solid var(--green); background: var(--glass);
    border-radius: 0 10px 10px 0; font-size: 14px; color: var(--mid); line-height: 1.6;
  }
  .note b { color: var(--ink); }

  h2.section {
    font-size: 13px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase;
    color: var(--low); margin: 52px 0 20px; padding-bottom: 10px; border-bottom: 1px solid var(--hair);
  }

  .config { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
  .fmt {
    display: flex; align-items: center; gap: 10px; cursor: pointer;
    border: 1px solid var(--hair); background: var(--glass);
    border-radius: 12px; padding: 12px 16px; font-size: 13px; font-weight: 600;
  }
  .fmt:hover { border-color: var(--green); }
  .fmt-box { display: block; width: 26px; border: 2px solid var(--mid); border-radius: 3px; }

  .scene {
    border: 1px solid var(--hair); border-radius: 16px;
    background: linear-gradient(180deg, var(--lift), transparent);
    padding: 22px; margin-bottom: 20px;
  }
  .scene-head { display: grid; grid-template-columns: 40px minmax(0,1fr) auto; gap: 16px; align-items: start; }
  .scene-index { font-size: 13px; font-weight: 800; letter-spacing: .1em; font-variant-numeric: tabular-nums; padding-top: 4px; }
  .kicker { font-size: 10px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; margin-bottom: 8px; }
  .scene-titles h3 { margin: 0; font-size: clamp(18px, 2.2vw, 26px); font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
  .scene-titles .body { margin: 10px 0 0; color: var(--mid); font-size: 14px; line-height: 1.55; }
  .scene-time { text-align: right; font-size: 12px; font-weight: 600; color: var(--mid); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .scene-time span { display: block; color: var(--low); font-weight: 500; }

  .shots { display: flex; flex-wrap: wrap; gap: 14px; margin: 20px 0 4px; }
  .shot { margin: 0; flex: 0 1 auto; min-width: 0; }
  .shot img {
    display: block; aspect-ratio: var(--aspect); object-fit: cover;
    height: 210px; width: auto; max-width: 100%;
    border-radius: 10px; border: 1px solid var(--hair); background: #000;
  }
  .shot figcaption { font-size: 11px; color: var(--low); margin-top: 7px; letter-spacing: .06em; }

  .facts { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 16px 0 18px; }
  .facts > div { display: flex; gap: 7px; align-items: baseline; }
  .facts dt { font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--low); margin: 0; }
  .facts dd { margin: 0; font-size: 12px; color: var(--mid); font-variant-numeric: tabular-nums; }

  .verdict { border-top: 1px solid var(--hair); padding-top: 16px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .radios { display: flex; flex-wrap: wrap; gap: 16px; }
  .radios label { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--mid); cursor: pointer; }
  .verdict textarea {
    flex: 1 1 320px; min-width: 0; resize: vertical;
    background: rgba(0,0,0,.35); color: var(--ink);
    border: 1px solid var(--hair); border-radius: 9px; padding: 10px 12px;
    font-family: inherit; font-size: 13px; line-height: 1.5;
  }
  .verdict textarea:focus { outline: none; border-color: var(--green); }
  button {
    background: var(--green); color: #04140C; border: 0; cursor: pointer;
    border-radius: 9px; padding: 10px 18px; font-family: inherit; font-size: 13px; font-weight: 700;
  }
  button:hover { filter: brightness(1.1); }
  button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--hair); }
  .queued { font-size: 12px; font-weight: 700; color: var(--green); }

  .audio-row { display: flex; flex-wrap: wrap; gap: 20px; align-items: center; }
  audio { max-width: 420px; width: 100%; }
  .env { flex: 1 1 260px; min-width: 0; }
  .env-bar { display: flex; height: 34px; gap: 2px; align-items: flex-end; }
  .env-bar i { flex: 1; background: var(--green); opacity: .55; border-radius: 2px 2px 0 0; }

  footer.send { margin-top: 44px; padding-top: 24px; border-top: 1px solid var(--hair); display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  footer.send p { margin: 0; flex: 1 1 260px; color: var(--mid); font-size: 13px; }

  @media (max-width: 640px) {
    .scene-head { grid-template-columns: 30px minmax(0,1fr); }
    .scene-time { grid-column: 2; text-align: left; }
    .shot img { height: 150px; }
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="top">
    <div class="eyebrow">Storyboard · level 4 review</div>
    <h1>${esc(episode.title)}</h1>
    ${episode.subtitle ? `<p class="sub">${esc(episode.subtitle)}</p>` : ""}
    <div class="meta">
      <span class="pill"><b>${episode.scenes.length}</b> scenes</span>
      <span class="pill"><b>${totalSeconds}s</b> runtime</span>
      <span class="pill"><b>${episode.fps}</b> fps</span>
      <span class="pill">subject <b>${esc(episode.subject)}</b></span>
      <span class="pill">theme <b>${esc(episode.theme)}</b></span>
    </div>
  </header>

  <div class="note">
    Every panel below is a <b>real frame rendered by Remotion</b>, not a mockup — so what you
    approve is exactly what renders. The previous storyboard was hand-drawn in CSS and had
    silently drifted to depict a light-theme variant that was never in the video.
    <br><br>
    Annotate anything directly, or use the per-scene controls. Timing, copy and camera all come
    from <b>src/episodes/${esc(episode.id)}.ts</b>; changes there regenerate this page.
  </div>

  <h2 class="section">1 · Output formats</h2>
  <form class="config" data-lavish-question="formats"
    onsubmit="submitFormats(event)">
    ${formatChecks}
    <button type="submit">Queue formats</button>
    <span class="queued" hidden>queued ✓</span>
  </form>

  <h2 class="section">2 · Scenes</h2>
  ${sceneCards}

  <h2 class="section">3 · Music bed</h2>
  <div class="audio-row">
    ${
      episode.audio
        ? `<audio controls preload="metadata" src="${esc(episode.audio.src)}"></audio>`
        : '<p class="sub">No music bed on this episode.</p>'
    }
    <div class="env">
      <div class="env-bar">${Array.from({ length: 40 }, (_, i) => {
        const p = i / 39;
        const h = p < 0.07 ? 30 + p * 400 : p < 0.13 ? 92 : p > 0.93 ? 20 : p > 0.86 ? 88 : 52;
        return `<i style="height:${Math.min(100, h)}%"></i>`;
      }).join("")}</div>
      <div style="font-size:11px;color:var(--low);margin-top:8px;letter-spacing:.06em">
        VOLUME ENVELOPE — lifts on the cold open and end card, sits back under the narration
      </div>
    </div>
  </div>

  <h2 class="section">4 · Anything else</h2>
  <form data-lavish-question="global" onsubmit="submitGlobal(event)">
    <textarea name="note" rows="3" style="width:100%;background:rgba(0,0,0,.35);color:var(--ink);border:1px solid var(--hair);border-radius:9px;padding:12px;font-family:inherit;font-size:14px;line-height:1.6" placeholder="Pacing, tone, colour, the 3D subject, the music, the script overall…"></textarea>
    <div style="margin-top:12px"><button type="submit">Queue note</button> <span class="queued" hidden>queued ✓</span></div>
  </form>

  <footer class="send">
    <p>Queued items collect in the Conversation panel. Press <b>Send to Agent</b> when you are done — everything arrives at once.</p>
    <button class="ghost" data-lavish-action onclick="window.lavish.sendQueuedPrompts()">Send everything now</button>
  </footer>

</div>

<script>
  // Per the input playbook: radio changes only update local state. Nothing is
  // queued until the user submits that specific question, so they can change
  // their mind freely.
  const flash = (form) => {
    const badge = form.querySelector('.queued');
    if (!badge) return;
    badge.hidden = false;
    setTimeout(() => { badge.hidden = true; }, 2600);
  };

  function submitScene(event, id) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const verdict = data.get('v');
    const note = (data.get('note') || '').toString().trim();
    if (verdict === 'approve' && !note) {
      window.lavish.queuePrompt('Scene "' + id + '": approved as rendered.', {
        tag: 'scene', text: id + ': approved', element: form,
        queueKey: 'scene-' + id, data: { scene: id, verdict: 'approve' }
      });
    } else {
      const verb = verdict === 'cut' ? 'CUT this scene' : 'needs changes';
      window.lavish.queuePrompt(
        'Scene "' + id + '" ' + verb + (note ? ': ' + note : '') +
        '. Edit the episode file in src/episodes/ and regenerate the storyboard.',
        { tag: 'scene', text: id + ': ' + verdict, element: form,
          queueKey: 'scene-' + id, data: { scene: id, verdict: verdict, note: note } }
      );
    }
    flash(form);
  }

  function submitFormats(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const picked = [...form.querySelectorAll('input[name=format]:checked')].map(el => el.value);
    window.lavish.queuePrompt(
      picked.length ? 'Render these formats: ' + picked.join(', ') + '.' : 'No output formats selected — please confirm.',
      { tag: 'choice', text: 'Formats: ' + (picked.join(', ') || 'none'), element: form,
        queueKey: 'formats', data: { formats: picked } }
    );
    flash(form);
  }

  function submitGlobal(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const note = (new FormData(form).get('note') || '').toString().trim();
    if (!note) return;
    window.lavish.queuePrompt('Overall storyboard note: ' + note, {
      tag: 'note', text: 'Overall: ' + note.slice(0, 60), element: form, queueKey: 'global'
    });
    flash(form);
  }
</script>
</body>
</html>`;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
