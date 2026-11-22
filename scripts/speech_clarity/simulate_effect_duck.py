# File Description: Offline what-if of ducking transition effects under speech on a delivered mix, measured with the same clarity metrics.
# Inputs and outputs: delivered mp4 + narration wav + film.json + effect cache dir (decoded in memory) -> JSON of before/after clarity per duck depth.
# Used by: run by hand when judging narration clarity; see docs/SPEECH_CLARITY.md.
# Rule simulated: only effects whose audio/library.json roles include "transition" are ducked under speech.
# Run: python3 -I scripts/speech_clarity/simulate_effect_duck.py <label> <mix.mp4> <voice.wav> <film.json> <effectCacheDir> [...]
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure_mix import band_powers, db, decode, find_lag, shift, sii_index, stoi  # noqa: E402

HOLD_SEC, PRE_DUCK_SEC, FPS = 0.6, 0.25, 30
LIBRARY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "audio", "library.json")


# Returns the library item ids whose roles include "transition", the only effects the mixer ducks under speech.
def transition_items():
    with open(LIBRARY_PATH) as handle:
        items = json.load(handle)["items"]
    return {i["id"] for i in items if i.get("kind") == "sfx" and "transition" in i.get("roles", [])}


# Mirrors the mixer's ramp: full depth inside a phrase, pre-duck over 0.25 s, release over the 0.6 s hold (dB).
def duck_db(t, phrases, depth):
    prev_end, next_start = -np.inf, np.inf
    for p in phrases:
        if p["startSec"] <= t <= p["endSec"]:
            return depth
        if p["endSec"] < t:
            prev_end = max(prev_end, p["endSec"])
        if p["startSec"] > t:
            next_start = min(next_start, p["startSec"])
    release = depth * (1 - min(1, max(0, (t - prev_end) / HOLD_SEC)))
    attack = depth * (1 - min(1, max(0, (next_start - t) / PRE_DUCK_SEC)))
    return min(0.0, release, attack)


# Builds per-sample gain from per-frame gains, linearly interpolated like the native envelope keyframes.
def sample_gain(frame_gains, start_sample, n, rate):
    t = (start_sample + np.arange(n)) / rate
    frames = np.arange(len(frame_gains)) / FPS + start_sample / rate
    return np.interp(t, frames, frame_gains)


# Fits each effect's level and lag into the non-voice residual so it can be removed and re-added with a new envelope.
def fit_effects(rest, effects, rate):
    fitted = []
    for e in effects:
        start = int(round(e["timeSec"] * rate))
        best = None
        n = len(e["signal"])
        sig = e["signal"]
        span = int(0.3 * rate)
        seg = rest[max(0, start - span) : start + n + span]
        corr = np.correlate(seg, sig, mode="valid")
        offset = int(np.argmax(np.abs(corr)))
        a = max(0, start - span) + offset
        seg = rest[a : a + n]
        sig = sig[: len(seg)]
        c = float(np.dot(seg, sig) / max(np.dot(sig, sig), 1e-12))
        best = (float(np.sum((seg - c * sig) ** 2)), a, c)
        _, a, c = best
        before = float(np.sum(rest[a : a + len(e["signal"])] ** 2))
        fitted.append({**e, "start": a, "coef": c, "explainedShare": round(1 - best[0] / max(before, 1e-12), 3)})
    return fitted


# Scores a candidate mix over speech seconds: SII-style index, per-second gap and STOI, near and away from effects.
def score(voice, other, speech_seconds, near, rate):
    mix = voice + other
    rows = []
    for s in speech_seconds:
        a, b = s * rate, (s + 1) * rate
        index, snr = sii_index(band_powers(voice[a:b], rate), band_powers(other[a:b], rate), rate)
        rows.append(
            {"t": s, "sii": index, "gap": db(np.mean(voice[a:b] ** 2)) - db(np.mean(other[a:b] ** 2)), "near": near(s)}
        )
    out = {}
    for name, sel in (
        ("all", rows),
        ("nearEffects", [r for r in rows if r["near"]]),
        ("awayFromEffects", [r for r in rows if not r["near"]]),
    ):
        sii = np.array([r["sii"] for r in sel])
        gap = np.array([r["gap"] for r in sel])
        out[name] = {
            "n": len(sel),
            "siiMean": round(float(sii.mean()), 3),
            "siiMin": round(float(sii.min()), 3),
            "secondsSiiBelow0_9": int((sii < 0.9).sum()),
            "gapMeanDb": round(float(gap.mean()), 1),
            "gapP10Db": round(float(np.percentile(gap, 10)), 1),
            "gapMinDb": round(float(gap.min()), 1),
        }
    # STOI is defined on 10 kHz signals; resample by FFT for the whole story and for 6 s chunks around each effect.
    n10 = int(len(mix) * 10000 / rate)
    v10 = np.fft.irfft(np.fft.rfft(voice)[: n10 // 2 + 1], n10) * n10 / len(voice)
    m10 = np.fft.irfft(np.fft.rfft(mix)[: n10 // 2 + 1], n10) * n10 / len(mix)
    out["stoi"] = round(stoi(v10, m10), 4)
    return out, rows, v10, m10


# Runs the what-if for one format at the given duck depths and returns before/after numbers.
def simulate(label, mix_path, voice_path, film_path, cache_dir, depths):
    rate = 16000
    film = json.load(open(film_path))
    soundtrack = film["soundtrack"]
    phrases = sorted(soundtrack["speech"], key=lambda p: p["startSec"])
    mix = decode(mix_path, rate)
    voice_raw = decode(voice_path, rate)
    lag = find_lag(mix, voice_raw, rate)
    story = min(len(mix), len(voice_raw) + max(lag, 0))
    v = shift(voice_raw, lag, story)
    m = mix[:story]
    gain = float(np.dot(m, v) / np.dot(v, v))
    voice = gain * v
    rest = m - voice
    effects = []
    for e in soundtrack["sfx"]:
        if e["timeSec"] * rate >= story:
            continue
        files = glob.glob(f"{cache_dir}/{e['item']}.*")
        effects.append({"item": e["item"], "timeSec": e["timeSec"], "signal": decode(files[0], rate)})
    fitted = fit_effects(rest, effects, rate)
    ducked_items = transition_items()
    music = rest.copy()
    for e in fitted:
        seg = slice(e["start"], e["start"] + len(e["signal"]))
        music[seg] -= e["coef"] * e["signal"][: len(music[seg])]
    frame10 = rate // 100
    raw_db = np.array([db(np.mean(v[i : i + frame10] ** 2)) for i in range(0, story - frame10, frame10)])
    speech_seconds = [s for s in range(story // rate) if (raw_db[s * 100 : (s + 1) * 100] > -40).mean() >= 0.5]

    def near(s):
        return any(e["timeSec"] - 1 <= s <= e["timeSec"] + 2.5 for e in fitted)

    results = {
        "label": label,
        "effects": [
            {k: (round(x, 3) if isinstance(x, float) else x) for k, x in e.items() if k != "signal"} for e in fitted
        ],
    }
    original, _, _, _ = score(voice, rest, speech_seconds, near, rate)
    results["deliveredAsIs"] = original
    for depth in depths:
        other = music.copy()
        for e in fitted:
            n = min(len(e["signal"]), story - e["start"])
            frames = int(np.ceil(n / rate * FPS)) + 1
            level = depth if e["item"] in ducked_items else 0
            gains = [10 ** (duck_db(e["start"] / rate + f / FPS, phrases, level) / 20) for f in range(frames)]
            other[e["start"] : e["start"] + n] += e["coef"] * e["signal"][:n] * sample_gain(gains, e["start"], n, rate)
        scored, rows, _, _ = score(voice, other, speech_seconds, near, rate)
        results[f"effectDuck{depth}dB"] = scored
        if depth == min(depths):
            results["worstSecondsAtDeepest"] = sorted(
                ({"t": r["t"], "sii": round(r["sii"], 3), "gap": round(r["gap"], 1)} for r in rows),
                key=lambda r: r["sii"],
            )[:6]
    return results


# Command line: label mp4 wav film.json cacheDir, repeated.
if __name__ == "__main__":
    a = sys.argv[1:]
    print(
        json.dumps(
            [simulate(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], [0, -10, -18]) for i in range(0, len(a), 5)],
            indent=1,
        )
    )
