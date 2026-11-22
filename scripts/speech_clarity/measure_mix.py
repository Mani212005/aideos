# File Description: Read-only speech-clarity measurement of a delivered aideos mix against its own narration stem.
# Inputs and outputs: delivered mp4 + narration wav (decoded in memory, never written) -> JSON report of per-second voice/music levels, SII-style band audibility, STOI, swells.
# Used by: run by hand when judging narration clarity; see docs/SPEECH_CLARITY.md.
# Run: python3 -I scripts/speech_clarity/measure_mix.py <label> <mix.mp4> <voice.wav> [<label> <mix.mp4> <voice.wav> ...]
import json
import subprocess
import sys

import numpy as np


# Decodes one audio stream to mono float32 at a sample rate through an ffmpeg pipe (nothing is written to disk).
def decode(path, rate):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    return np.frombuffer(out, dtype=np.float32).astype(np.float64)


# Finds the sample lag of the narration inside the mix by FFT cross-correlation over the first minute.
def find_lag(mix, voice, rate):
    n = min(len(mix), len(voice), 60 * rate)
    a, b = mix[:n], voice[:n]
    size = 1 << int(np.ceil(np.log2(2 * n)))
    corr = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    lags = np.concatenate([np.arange(0, size // 2), np.arange(-size // 2, 0)])
    window = np.abs(lags) <= rate // 2
    return int(lags[window][np.argmax(corr[window])])


# Shifts a signal by a lag and pads or trims it to a length.
def shift(signal, lag, length):
    out = np.zeros(length)
    if lag >= 0:
        seg = signal[: max(0, length - lag)]
        out[lag : lag + len(seg)] = seg
    else:
        seg = signal[-lag : -lag + length]
        out[: len(seg)] = seg
    return out


# Converts mean power to decibels with a finite floor.
def db(power):
    return float(10 * np.log10(max(power, 1e-12)))


# Centre frequencies and ANSI S3.5 one-third-octave band importance (average speech) for the SII-style index.
SII_BANDS = [160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000]
SII_WEIGHTS = [
    0.0083,
    0.0095,
    0.0150,
    0.0289,
    0.0440,
    0.0578,
    0.0653,
    0.0711,
    0.0818,
    0.0844,
    0.0882,
    0.0898,
    0.0868,
    0.0844,
    0.0771,
    0.0527,
    0.0364,
    0.0185,
]


# Returns per-band power of a window for the SII bands up to Nyquist.
def band_powers(x, rate):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / rate)
    powers = []
    for cf in SII_BANDS:
        lo, hi = cf * 2 ** (-1 / 6), cf * 2 ** (1 / 6)
        sel = (freqs >= lo) & (freqs < min(hi, rate / 2))
        powers.append(spec[sel].sum() if sel.any() else 0.0)
    return np.array(powers)


# SII-style audibility: band SNR clipped to [-15, 15] dB, mapped to [0, 1], weighted by band importance (no hearing threshold or spread of masking).
def sii_index(voice_bands, noise_bands, rate):
    usable = [i for i, cf in enumerate(SII_BANDS) if cf * 2 ** (1 / 6) <= rate / 2]
    weights = np.array([SII_WEIGHTS[i] for i in usable])
    snr = 10 * np.log10(np.maximum(voice_bands[usable], 1e-20) / np.maximum(noise_bands[usable], 1e-20))
    audibility = (np.clip(snr, -15, 15) + 15) / 30
    return float((weights * audibility).sum() / weights.sum()), snr


# Short-time objective intelligibility (Taal et al. 2011) of a degraded signal against its clean reference at 10 kHz.
def stoi(clean, degraded, rate=10000):
    frame, nfft, hop, n_seg, beta, dyn = 256, 512, 128, 30, -15.0, 40.0
    win = np.hanning(frame + 2)[1:-1]
    starts = range(0, len(clean) - frame, hop)
    frames_x = np.array([clean[s : s + frame] * win for s in starts])
    frames_y = np.array([degraded[s : s + frame] * win for s in starts])
    energy = 20 * np.log10(np.linalg.norm(frames_x, axis=1) + 1e-12)
    keep = energy > energy.max() - dyn
    frames_x, frames_y = frames_x[keep], frames_y[keep]
    X = np.abs(np.fft.rfft(frames_x, nfft)) ** 2
    Y = np.abs(np.fft.rfft(frames_y, nfft)) ** 2
    freqs = np.fft.rfftfreq(nfft, 1 / rate)
    bands = []
    for k in range(15):
        lo, hi = 150 * 2 ** ((2 * k - 1) / 6), 150 * 2 ** ((2 * k + 1) / 6)
        bands.append((freqs >= lo) & (freqs < hi))
    xb = np.sqrt(np.array([X[:, b].sum(axis=1) for b in bands]))
    yb = np.sqrt(np.array([Y[:, b].sum(axis=1) for b in bands]))
    clip = 10 ** (-beta / 20)
    scores = []
    for m in range(n_seg, xb.shape[1] + 1):
        x = xb[:, m - n_seg : m]
        y = yb[:, m - n_seg : m]
        alpha = np.linalg.norm(x, axis=1, keepdims=True) / (np.linalg.norm(y, axis=1, keepdims=True) + 1e-12)
        y = np.minimum(alpha * y, x * (1 + clip))
        x = x - x.mean(axis=1, keepdims=True)
        y = y - y.mean(axis=1, keepdims=True)
        corr = (x * y).sum(axis=1) / (np.linalg.norm(x, axis=1) * np.linalg.norm(y, axis=1) + 1e-12)
        scores.append(corr.mean())
    return float(np.mean(scores)) if scores else float("nan")


# Measures one delivered mix: separates voice by least squares, then reports levels, band audibility, STOI and swells.
def measure(mix_path, voice_path, label):
    rate = 16000
    mix = decode(mix_path, rate)
    voice_raw = decode(voice_path, rate)
    lag = find_lag(mix, voice_raw, rate)
    story = min(len(mix), len(voice_raw) + max(lag, 0))
    v = shift(voice_raw, lag, story)
    m = mix[:story]
    frame = rate // 100
    raw_db = np.array([db(np.mean(v[i : i + frame] ** 2)) for i in range(0, story - frame, frame)])
    active = raw_db > -40  # SPEECH_FLOOR_DB on the narration stem, as the mixer defines it
    gain = float(np.dot(m, v) / np.dot(v, v))
    voice = gain * v
    rest = m - voice  # music + effects + codec error
    seconds = []
    for s in range(story // rate):
        a, b = s * rate, (s + 1) * rate
        speech_share = float(active[s * 100 : (s + 1) * 100].mean()) if s * 100 < len(active) else 0.0
        vb, nb = band_powers(voice[a:b], rate), band_powers(rest[a:b], rate)
        index, snr = sii_index(vb, nb, rate)
        seconds.append(
            {
                "t": s,
                "speechShare": round(speech_share, 2),
                "voiceDb": round(db(np.mean(voice[a:b] ** 2)), 1),
                "musicDb": round(db(np.mean(rest[a:b] ** 2)), 1),
                "sii": round(index, 3),
                "presenceSnrDb": round(
                    float(np.mean(snr[[SII_BANDS.index(f) for f in (1000, 1250, 1600, 2000, 2500, 3150, 4000)]])), 1
                ),
                "lowMidSnrDb": round(float(np.mean(snr[[SII_BANDS.index(f) for f in (200, 250, 315, 400, 500)]])), 1),
            }
        )
    speech = [x for x in seconds if x["speechShare"] >= 0.5]
    gaps = np.array([x["voiceDb"] - x["musicDb"] for x in speech])
    music_speech = np.array([x["musicDb"] for x in speech])
    median_music = float(np.median(music_speech))
    swells = [x for x in speech if x["musicDb"] - median_music >= 4]
    low = sorted(speech, key=lambda x: x["sii"])[:8]
    # Whole-story band SNR averaged over speech seconds shows which bands the music competes in.
    band_snr = np.zeros(sum(1 for cf in SII_BANDS if cf * 2 ** (1 / 6) <= rate / 2))
    for x in speech:
        a = x["t"] * rate
        _, snr = sii_index(band_powers(voice[a : a + rate], rate), band_powers(rest[a : a + rate], rate), rate)
        band_snr += snr
    band_snr /= max(1, len(speech))
    r10 = 10000
    mix10 = decode(mix_path, r10)
    v10 = shift(decode(voice_path, r10), int(round(lag * r10 / rate)), min(len(mix10), story * r10 // rate))
    mix10 = mix10[: len(v10)]
    stoi_all = stoi(gain * v10, mix10)
    chunk = 6 * r10
    stoi_chunks = [
        {"t": i // r10, "stoi": round(stoi(gain * v10[i : i + chunk], mix10[i : i + chunk]), 4)}
        for i in range(0, len(v10) - chunk, chunk)
    ]
    return {
        "label": label,
        "lagSamples16k": lag,
        "voiceGainInMix": round(gain, 4),
        "voiceGainInMixDb": round(20 * np.log10(gain), 2),
        "speechSeconds": len(speech),
        "gapDb": {
            "mean": round(float(gaps.mean()), 1),
            "p10": round(float(np.percentile(gaps, 10)), 1),
            "min": round(float(gaps.min()), 1),
            "median": round(float(np.median(gaps)), 1),
        },
        "musicUnderSpeechDb": {
            "median": round(median_music, 1),
            "p90": round(float(np.percentile(music_speech, 90)), 1),
            "max": round(float(music_speech.max()), 1),
        },
        "sii": {
            "mean": round(float(np.mean([x["sii"] for x in speech])), 3),
            "min": low[0]["sii"],
            "secondsBelow0_9": sum(1 for x in speech if x["sii"] < 0.9),
        },
        "presenceSnrDbMean": round(float(np.mean([x["presenceSnrDb"] for x in speech])), 1),
        "lowMidSnrDbMean": round(float(np.mean([x["lowMidSnrDb"] for x in speech])), 1),
        "bandSnrDb": {str(f): round(float(s), 1) for f, s in zip(SII_BANDS, band_snr)},
        "stoi": round(stoi_all, 4),
        "stoiWorstChunks": sorted(stoi_chunks, key=lambda x: x["stoi"])[:5],
        "swellsUnderSpeech": [
            {
                "t": x["t"],
                "musicDb": x["musicDb"],
                "aboveMedianDb": round(x["musicDb"] - median_music, 1),
                "gapDb": round(x["voiceDb"] - x["musicDb"], 1),
                "sii": x["sii"],
            }
            for x in swells
        ],
        "lowestSiiSeconds": low,
        "perSecond": seconds,
    }


# Runs the measurement for each (label, mp4, wav) triple on the command line and prints JSON.
if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) % 3:
        sys.exit("usage: measure_mix.py <label> <mix.mp4> <voice.wav> [...]")
    print(json.dumps([measure(args[i + 1], args[i + 2], args[i]) for i in range(0, len(args), 3)], indent=1))
