# File Description: Procedural audio for the film "RAG, in four steps". Two modes. "analyze" finds where each narrated
# line's first and last sound sit inside the raw Kokoro take. "render" re-times every line onto the tempo grid
# (a gentle atempo stretch plus a placement on its beat), synthesizes an original drum, bass, pad and arp track in
# numpy (no samples, no music service), ducks that track under the voice, and writes the fitted voiceover and the
# beat as separate stems. Everything is deterministic: the same plan always writes the same audio.
import json
import re
import subprocess
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter

SR = 44100

# Chord loop, one chord per bar: Am F C G. Triads as semitone offsets over each root (Hz).
PROGRESSION = [
    (55.0, [0, 3, 7]),       # A minor
    (43.654, [0, 4, 7]),     # F major
    (65.406, [0, 4, 7]),     # C major
    (49.0, [0, 4, 7]),       # G major
]

# Beat stem loudness (integrated LUFS) before Remotion's fixed 0.25 background music gain.
BEAT_TARGET_LUFS = -12.0

# Ducking: how far the music drops while the voice speaks, in dB, per bus.
DUCK_MUSIC_DB = 9.0
DUCK_DRUMS_DB = 5.0


# Reads any audio file into a float32 stereo array at SR through ffmpeg, optionally cutting and time-stretching it.
def read_audio(path, start=None, dur=None, tempo=1.0):
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.6f}"]
    if dur is not None:
        cmd += ["-t", f"{dur:.6f}"]
    cmd += ["-i", path]
    if abs(tempo - 1.0) > 1e-4:
        cmd += ["-af", f"atempo={tempo:.6f}"]
    cmd += ["-f", "f32le", "-ac", "2", "-ar", str(SR), "pipe:1"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


# Returns the seconds, from the start of the array, of the first and last 10 ms window above the speech floor.
def speech_extent(audio, floor_db=-45.0):
    mono = audio.mean(axis=1)
    win = int(SR * 0.01)
    n = len(mono) // win
    if n == 0:
        return 0.0, 0.0
    rms = np.sqrt((mono[: n * win].reshape(n, win) ** 2).mean(axis=1) + 1e-12)
    live = np.where(20 * np.log10(rms) > floor_db)[0]
    if len(live) == 0:
        return 0.0, 0.0
    return live[0] * 0.01, (live[-1] + 1) * 0.01


# Mode "analyze": raw wav plus [[start, end], ...] segment ranges in, per-segment [onset, offset] seconds out.
def analyze(raw_path, ranges_path, out_path):
    with open(ranges_path) as fh:
        ranges = json.load(fh)
    audio = read_audio(raw_path)
    result = []
    for start, end in ranges:
        chunk = audio[int(start * SR): int(end * SR)]
        onset, offset = speech_extent(chunk)
        result.append({"onsetSec": round(onset, 3), "offsetSec": round(offset, 3)})
    with open(out_path, "w") as fh:
        json.dump(result, fh)


# Adds a signal into a buffer at a sample index, clipping at the buffer edges.
def add(buf, idx, sig):
    if idx >= len(buf) or idx + len(sig) <= 0:
        return
    lo = max(0, -idx)
    hi = min(len(sig), len(buf) - idx)
    buf[idx + lo: idx + hi] += sig[lo:hi]


# Applies a butterworth filter ("low" or "high") to a signal.
def filt(sig, kind, hz, order=2):
    b, a = butter(order, hz / (SR / 2), btype=kind)
    return lfilter(b, a, sig)


# A kick drum: a pitch-swept sine with a short click.
def kick(level=1.0):
    t = np.arange(int(SR * 0.42)) / SR
    freq = 46 + 110 * np.exp(-t / 0.035)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t / 0.16)
    click = filt(np.random.default_rng(1).standard_normal(len(t)), "high", 2500) * np.exp(-t / 0.004) * 0.12
    return (body + click) * level


# A snare: a short tone plus high-passed noise.
def snare(level=1.0, seed=2):
    t = np.arange(int(SR * 0.22)) / SR
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05) * 0.45
    noise = filt(np.random.default_rng(seed).standard_normal(len(t)), "high", 1800) * np.exp(-t / 0.085) * 0.6
    return (tone + noise) * level


# A clap: three tight noise bursts then a short tail.
def clap(level=1.0):
    rng = np.random.default_rng(3)
    out = np.zeros(int(SR * 0.2))
    for k, off in enumerate([0.0, 0.011, 0.022]):
        n = int(SR * 0.012)
        burst = filt(rng.standard_normal(n), "high", 1200) * np.exp(-np.arange(n) / SR / 0.006)
        add(out, int(off * SR), burst * (0.7 if k < 2 else 0.0))
    t = np.arange(len(out)) / SR
    tail = filt(rng.standard_normal(len(out)), "high", 1500) * np.exp(-t / 0.05) * 0.25
    tail[: int(0.022 * SR)] *= 0.0
    return (out + tail) * level


# A hi-hat: high-passed noise, closed or open.
def hat(open_hat=False, level=1.0, seed=4):
    t = np.arange(int(SR * (0.22 if open_hat else 0.06))) / SR
    noise = filt(np.random.default_rng(seed).standard_normal(len(t)), "high", 7000)
    return noise * np.exp(-t / (0.09 if open_hat else 0.018)) * level * 0.5


# A crash cymbal for section changes: a long bright noise wash.
def crash(level=1.0):
    t = np.arange(int(SR * 1.8)) / SR
    noise = filt(np.random.default_rng(5).standard_normal(len(t)), "high", 3500)
    return noise * np.exp(-t / 0.55) * level * 0.4


# A sub bass note: sine plus a soft second harmonic, with a short attack and a release.
def bass_note(freq, dur):
    n = int(SR * (dur + 0.06))
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t)
    env = np.minimum(1.0, t / 0.008) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.02))
    return np.tanh(sig * 1.4) * env * 0.5


# A band-limited saw voice (additive) at a frequency, over t seconds.
def saw(freq, t, harmonics=7):
    out = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        if freq * h < 5000:
            out += np.sin(2 * np.pi * freq * h * t) / h
    return out * 0.6


# One bar of pad: a detuned triad, slow attack and release, low-passed, in stereo.
def pad_bar(root, intervals, bar_sec, bright):
    n = int(SR * (bar_sec + 0.5))
    t = np.arange(n) / SR
    env = np.minimum(1.0, t / 0.35) * np.where(t < bar_sec, 1.0, np.exp(-(t - bar_sec) / 0.18))
    out = np.zeros((n, 2))
    for k, semis in enumerate(intervals):
        f = root * 4 * 2 ** (semis / 12)
        for ch, det in enumerate((0.996, 1.004)):
            out[:, ch] += saw(f * det, t)
    out *= env[:, None] * 0.11
    cutoff = 2400 if bright else 1100
    return np.stack([filt(out[:, 0], "low", cutoff), filt(out[:, 1], "low", cutoff)], axis=1)


# A plucked arp note: a triangle-ish tone with a fast decay.
def pluck(freq, dur=0.3):
    t = np.arange(int(SR * dur)) / SR
    sig = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t) + 0.12 * np.sin(2 * np.pi * 3 * freq * t)
    return sig * np.exp(-t / 0.1) * np.minimum(1.0, t / 0.003) * 0.22


# Shapes the beat's intensity per line: 0 breakdown, 1 sparse groove, 2 full drums, 3 + arp and clap, 4 peak.
def line_level(line):
    sid = line["id"]
    chapter = line["chapter"]
    if sid == "wrong":
        return 0
    if sid in ("nexttoken", "lookup"):
        return 2
    return {0: 1, 1: 3, 2: 3, 3: 4, 4: 3}[chapter] if sid not in ("recap", "end") else 4


# Synthesizes the beat bus pair (drums, music) as stereo float arrays over total_sec.
def synth_beat(plan):
    bpm = plan["bpm"]
    beat = 60.0 / bpm
    step = beat / 2
    total = plan["totalSec"]
    n = int((total + 1.0) * SR)
    drums = np.zeros((n, 2))
    music = np.zeros((n, 2))
    kick_times = []

    lines = plan["lines"]
    last_line_end = lines[-1]["startSec"] + lines[-1]["beats"] * beat

    # Level and chapter at a time.
    def level_at(sec):
        for line in lines:
            if line["startSec"] <= sec < line["startSec"] + line["beats"] * beat - 1e-6:
                return line_level(line)
        return 4 if sec < last_line_end + 0.01 else -1

    kick_wave = kick()
    snare_wave = snare()
    clap_wave = clap()
    n_bars = int(np.ceil(last_line_end / (4 * beat)))
    rng = np.random.default_rng(7)

    for bar in range(n_bars):
        bar_t = bar * 4 * beat
        root, intervals = PROGRESSION[bar % 4]
        bar_level = level_at(bar_t + 2 * beat)
        if bar_level < 0:
            continue
        bright = bar_level >= 4
        # Pad: always present, brighter at the peak.
        pad = pad_bar(root, intervals, 4 * beat, bright)
        gain = 0.8 if bar_level == 0 else 0.6
        add(music[:, 0], int(bar_t * SR), pad[:, 0] * gain)
        add(music[:, 1], int(bar_t * SR), pad[:, 1] * gain)
        for s in range(8):
            t0 = bar_t + s * step
            lv = level_at(t0 + 0.01)
            if lv < 0:
                continue
            i0 = int(t0 * SR)
            # Kick pattern grows with intensity.
            if lv == 0:
                kicks = {0: 0.6}
            elif lv == 1:
                kicks = {0: 1.0, 5: 0.9}
            else:
                kicks = {0: 1.0, 3: 0.8, 5: 0.9}
                if lv >= 4 and s == 7 and bar % 2 == 1:
                    kicks[7] = 0.7
            if s in kicks:
                add(drums[:, 0], i0, kick_wave * kicks[s])
                add(drums[:, 1], i0, kick_wave * kicks[s])
                kick_times.append(t0)
            # Snare and clap on beats 2 and 4.
            if lv >= 2 and s in (2, 6):
                add(drums[:, 0], i0, snare_wave * 0.85)
                add(drums[:, 1], i0, snare_wave * 0.85)
                if lv >= 3:
                    add(drums[:, 0], i0, clap_wave * 0.5)
                    add(drums[:, 1], i0, clap_wave * 0.5)
            # Hats: eighths, with an open hat on the last offbeat and 16th ghosts at higher intensity.
            if lv >= 1:
                swing = 0.014 if s % 2 else 0.0
                hi0 = i0 + int(swing * SR)
                h = hat(open_hat=(s == 7 and lv >= 2), level=0.75 if s % 2 else 1.0, seed=10 + s)
                pan = 0.45 + 0.1 * (s % 2)
                add(drums[:, 0], hi0, h * (1 - pan) * 1.2)
                add(drums[:, 1], hi0, h * pan * 1.2)
                if lv >= 3:
                    g = hat(level=0.35, seed=30 + s)
                    gi = i0 + int(step * 0.5 * SR)
                    add(drums[:, 0], gi, g * 0.5)
                    add(drums[:, 1], gi, g * 0.7)
            # Bass follows the kick: root on the downbeat, a pickup on the 'and' of beat two.
            if lv >= 1:
                if s == 0:
                    note = bass_note(root, 2.5 * step)
                    add(music[:, 0], i0, note)
                    add(music[:, 1], i0, note)
                elif s in (3, 5) and lv >= 2:
                    f = root * (2 if s == 3 else 1)
                    note = bass_note(f, 1.4 * step)
                    add(music[:, 0], i0, note * 0.8)
                    add(music[:, 1], i0, note * 0.8)
            # Arp: eighth-note chord tones two octaves up.
            if lv >= 3:
                semis = intervals[[0, 1, 2, 1, 2, 1, 0, 1][s] % 3] + (12 if s >= 4 else 0)
                f = root * 8 * 2 ** (semis / 12)
                p = pluck(f)
                add(music[:, 0], i0, p * (1.0 if s % 2 == 0 else 0.5))
                add(music[:, 1], i0, p * (0.5 if s % 2 == 0 else 1.0))
        # Crash on a section change: first bar of a new chapter or the peak.
    for line_idx, line in enumerate(lines):
        if line_idx == 0:
            continue
        if lines[line_idx - 1]["chapter"] != line["chapter"] or line["id"] in ("title", "recap", "garbage"):
            i0 = int(line["startSec"] * SR)
            add(drums[:, 0], i0, crash(0.8))
            add(drums[:, 1], i0, crash(0.8))

    # Final chord and kick on the downbeat after the last line, ringing out through the tail.
    end_t = last_line_end
    i_end = int(end_t * SR)
    add(drums[:, 0], i_end, kick_wave * 1.0)
    add(drums[:, 1], i_end, kick_wave * 1.0)
    add(drums[:, 0], i_end, crash(0.9))
    add(drums[:, 1], i_end, crash(0.9))
    tail_pad = pad_bar(PROGRESSION[0][0], PROGRESSION[0][1], 1.6, True)
    add(music[:, 0], i_end, tail_pad[:, 0] * 1.2)
    add(music[:, 1], i_end, tail_pad[:, 1] * 1.2)
    add(music[:, 0], i_end, bass_note(55.0, 1.4))
    add(music[:, 1], i_end, bass_note(55.0, 1.4))

    # Sidechain pump: the music dips under each kick so the low end breathes.
    pump = np.ones(n)
    for t0 in kick_times:
        i0 = int(t0 * SR)
        seg = min(int(0.2 * SR), n - i0)
        if seg > 0:
            pump[i0: i0 + seg] = np.minimum(pump[i0: i0 + seg], 1 - 0.45 * np.exp(-np.arange(seg) / SR / 0.07))
    music *= pump[:, None]
    return drums, music


# Smooth speech activity (0..1) from a voice track, fast to attack and slow to release.
def voice_activity(voice):
    mono = np.abs(voice).max(axis=1)
    win = int(SR * 0.01)
    n = len(mono) // win
    frames = mono[: n * win].reshape(n, win).max(axis=1)
    db = 20 * np.log10(frames + 1e-6)
    act = np.clip((db + 46.0) / 10.0, 0.0, 1.0)  # fully active above -36 dBFS
    smooth = np.zeros(n)
    prev = 0.0
    for i, a in enumerate(act):
        coef = 0.35 if a > prev else 0.045  # 10 ms frames: ~25 ms attack, ~220 ms release
        prev = prev + (a - prev) * coef
        smooth[i] = prev
    full = np.interp(np.arange(len(voice)) / SR, (np.arange(n) + 0.5) * 0.01, smooth)
    return full


# Measures integrated loudness of a stereo array in LUFS through ffmpeg's ebur128.
def integrated_lufs(audio, tmp_path):
    wavfile.write(tmp_path, SR, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
    run = subprocess.run(["ffmpeg", "-nostats", "-i", tmp_path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True)
    found = re.findall(r"I:\s+(-?\d+\.\d+) LUFS", run.stderr)
    return float(found[-1])


# Mode "render": builds fitted voice and the ducked beat from a plan, writes both wavs.
def render(plan_path):
    with open(plan_path) as fh:
        plan = json.load(fh)
    total = plan["totalSec"]
    n = int(total * SR) + SR
    voice = np.zeros((n, 2))
    for line in plan["lines"]:
        lead = plan["leadSec"]
        start = line["rawStartSec"] + line["onsetSec"] - lead
        dur = line["offsetSec"] - line["onsetSec"] + lead + 0.04
        clip = read_audio(plan["rawWav"], max(0.0, start), dur, line["tempo"])
        fade_in = int(0.003 * SR)
        fade_out = min(len(clip), int(0.02 * SR))
        clip[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
        clip[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
        add(voice, int(round((line["startSec"] - lead / line["tempo"]) * SR)), clip)
    voice = voice[: int(total * SR)]

    drums, music = synth_beat(plan)
    drums = drums[: len(voice)]
    music = music[: len(voice)]
    act = voice_activity(voice)[:, None]
    ducked = drums * (10 ** (-DUCK_DRUMS_DB * act / 20)) + music * (10 ** (-DUCK_MUSIC_DB * act / 20))

    # Fade the whole beat in over the first beat and out over the film's tail, then master it.
    beat = 60.0 / plan["bpm"]
    fade_in = int(beat * SR)
    ducked[:fade_in] *= np.linspace(0.0, 1.0, fade_in)[:, None]
    fade_out = int(1.6 * SR)
    ducked[-fade_out:] *= np.linspace(1.0, 0.0, fade_out)[:, None] ** 2
    ducked = filt(ducked[:, 0], "high", 30), filt(ducked[:, 1], "high", 30)
    ducked = np.stack(ducked, axis=1)

    lufs = integrated_lufs(ducked, plan["beatOut"] + ".probe.wav")
    ducked *= 10 ** ((BEAT_TARGET_LUFS - lufs) / 20)
    ducked = np.tanh(ducked * 0.9) / np.tanh(0.9)  # gentle soft clip so the stem peaks stay under full scale
    peak = np.abs(ducked).max()
    if peak > 0.89:
        ducked *= 0.89 / peak
    wavfile.write(plan["beatOut"], SR, (ducked * 32767).astype(np.int16))
    vpeak = np.abs(voice).max()
    if vpeak > 0.99:
        voice *= 0.99 / vpeak
    wavfile.write(plan["voiceOut"], SR, (np.clip(voice, -1, 1) * 32767).astype(np.int16))
    print(json.dumps({"beatLufsBeforeGain": round(lufs, 2), "beatPeak": round(float(np.abs(ducked).max()), 3)}))


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "analyze":
        analyze(sys.argv[2], sys.argv[3], sys.argv[4])
    elif mode == "render":
        render(sys.argv[2])
    else:
        raise SystemExit(f"unknown mode {mode}")
