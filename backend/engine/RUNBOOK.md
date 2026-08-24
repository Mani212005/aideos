<!--
File Description: Runbook for driving the remote GPU box (Wan2GP) to render Aideos
b-roll clips: pinned versions, env activation, tmux recipe, exact render commands,
rsync return path, and disk hygiene. Everything heavy stays on the box.
-->

# GPU Box Runbook (Wan2GP)

## Box facts

- Host: `100.98.174.122`, user `s03714802824` (SSH password auth).
- GPU: NVIDIA L4 (23 GB). Aideos budget: stay under ~8 GB peak VRAM.
- Disk: NFS-backed /home, ~1.2 TB free at setup time.
- No sudo, no Docker. Everything is user-space conda + pip.

## Pinned versions

- Wan2GP: v12.61 line, git master at commit `8681e9f777f9f847f74a0bdefd13d5b9a6efe12d`
  (installed 2026-08-24 at `~/Wan2GP` on the box).
- Python: `~/wangp-env` (conda env, Python 3.11.11).
- PyTorch: 2.7.1 + cu128 wheels (`torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1`
  from `download.pytorch.org/whl/cu128`), chosen to match the driver's CUDA 12.8.
- Model: Wan2.1 T2V-1.3B quantized (mbf16 transformer + int8 quanto text encoder),
  auto-downloaded into `~/Wan2GP/ckpts` on first use.

## Measured numbers (2026-08-24)

- Peak VRAM: **4243 MiB (~4.1 GB)** across the smoke clip and three production clips
  (polled every 5s via nvidia-smi). Well under the 8 GB budget.
- Time per 5s clip (81 frames, 832x480): **~6m37s warm** (weights cached);
  the very first render took ~39 min including all weight downloads.
- Clip size: 2.5-5.4 MB per 5s mp4.

## Environment activation

```bash
ssh s03714802824@100.98.174.122
# system python is Intel oneAPI 3.9; never use it directly
~/wangp-env/bin/python -V   # or: conda run -p ~/wangp-env python
```

## Install (one-time, already done)

```bash
git clone https://github.com/deepbeepmeep/Wan2GP.git ~/Wan2GP
cd ~/Wan2GP
~/wangp-env/bin/pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 \
  --index-url https://download.pytorch.org/whl/cu128
~/wangp-env/bin/pip install -r requirements.txt
```

Model weights auto-download into `~/Wan2GP/ckpts` on first use of the model type
(~16 GB total: shared auxiliary ckpts plus the Wan2.1 t2v-1.3B quantized weights).
Profile in use: Wan2.1 T2V-1.3B quantized (int8 quanto transformer), the smallest
credible config; measured peak 4.1 GB VRAM.

## SSH auth (one-time, already done)

The engine prefers a dedicated key: `~/.ssh/wan_gpu_key` (ed25519), whose public half
is installed in `~/.ssh/authorized_keys` on the box. With the key present, ssh/scp/rsync
run directly in batch mode. Without it, the engine falls back to `/usr/bin/expect`
answering the password prompt from `WAN_GPU_PASSWORD` (never written to disk or argv).

## Canonical render settings

- Template of record: `backend/engine/profiles/small.json` in the Aideos repo
  (the full WanGP factory defaults for `t2v_1.3B` at 832x480, harvested from
  `get_default_settings()` on the box; the engine overlays prompt / seed /
  video_length per job).
- Gotcha: a `--process` `.json` settings file must be the **bare params dict**
  (`{"model_type": ...}`), NOT the `{"id": 1, "params": {...}}` wrapper shape;
  the wrapper is only for queue manifests and gets double-wrapped, which surfaces
  as a confusing "Settings must contain 'model_type'" error.
- The Aideos engine (`backend/engine/sshWanGPEngine.ts`) turns a `VideoJobSpec`
  into a job JSON, scp's it to `~/wangp-jobs/<jobId>.json` on the box, and launches:

```bash
tmux new-session -d -s wangp-<jobId> \
  'cd ~/Wan2GP && ~/wangp-env/bin/python wgp.py --process ~/wangp-jobs/<jobId>.json \
   --output-dir ~/wangp-out/<jobId> > ~/wangp-jobs/<jobId>.log 2>&1'
```

- Dry-run validation without GPU work:
  `~/wangp-env/bin/python wgp.py --process <job>.json --dry-run`

## Manual one-off render (no Aideos involved)

```bash
cd ~/Wan2GP
tmux new-session -d -s wangp-manual \
  '~/wangp-env/bin/python wgp.py --process ~/wangp-jobs/manual.json --output-dir ~/wangp-out/manual 2>&1 | tee ~/wangp-jobs/manual.log'
tmux attach -t wangp-manual    # watch; Ctrl-b d to detach without killing
tail -f ~/wangp-jobs/manual.log
nvidia-smi                     # watch VRAM; report peak via: nvidia-smi --query-gpu=memory.max --format=csv  # or a poller
```

Peak VRAM measurement used for the report:

```bash
while true; do nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits >> ~/vram.log; sleep 5; done
```

(Started before the render, stopped after; max of that log is the observed peak.)

## Getting clips back

```bash
rsync -av --partial s03714802824@100.98.174.122:~/wangp-out/<jobId>/ out/gpu-test/
```

Verify by probing duration/size rather than trusting exit codes:
`ffprobe -v error -show_entries format=duration,size <clip>.mp4`

## From Aideos (the wired loop)

```bash
export WAN_GPU_PASSWORD=<box password>   # only needed when no SSH key is installed
npm run backend -- engine-test "<prompt>" --engine ssh-wangp --seconds 5
# lands in out/gpu-test/aideos-<id>.mp4
```

## Inserting a clip into a film (proven path)

1. Resample the clip to the film fps into a frames dir:
   `ffmpeg -i out/gpu-test/<clip>.mp4 -vf fps=30 public/gpu_robot_arm/frame_%04d.png`
2. Reference it from a shot's blocks (no schema change needed):
   `{ "c": "AnalogyInset", "caption": "...", "framesDir": "gpu_robot_arm",
      "totalFrames": 144, "delayFrames": 30, "fullScreenHero": true }`
3. `public/gpu_robot_arm/` is gitignored (repo convention for frame sequences);
   the frames stay local, the film data references them.
4. `npm run validate` then `npx remotion render Long out/long.mp4 --gl=angle`
   (the `--gl=angle` flag avoids a flaky SwiftShader WebGL context failure on macOS).

## Politeness and disk hygiene

- Serial jobs only: one tmux render at a time; the box is shared.
- Prune finished outputs older than a few days:
  `find ~/wangp-out ~/wangp-jobs -type f -mtime +4 -delete`
- Never exceed ~8 GB VRAM; if other tenants are active (`nvidia-smi`), wait.
- Long steps always under tmux so dropped SSH never kills them.
