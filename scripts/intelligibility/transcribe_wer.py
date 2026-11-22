# File Description: Speech-to-text half of the narration intelligibility round trip: transcribes narration wavs with a locally cached Whisper model and scores word error rate against the script.
# Inputs and outputs: a script text file, one or more wavs (decoded in memory, never written) -> JSON report per wav of plain WER, the spelling-blind misheard rate, the misheard word runs and the transcript.
# Used by: scripts/intelligibility/round_trip.ts (spawned with the chosen python); see docs/GOOD_VIDEO.md "House pace".
# Run: python3 scripts/intelligibility/transcribe_wer.py <script.txt> <out.json> <wav> [<wav> ...]
#
# Engine: openai-whisper, the speech-to-text the scene kit already uses (backend/sceneKit/whisperWords.py), model "small",
# run offline from the local model cache. The 2026-11-21 pace evidence was measured with another engine (faster-whisper
# small.en), so its numbers are not comparable with this scorer's.
# Decoding is pinned to temperature 0 (greedy): the engine's default fallback to sampled decoding made the same wav
# score 6.8% on one run and 9.4% on the next, which is more than the stretch effect being measured.
import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

SAMPLE_RATE = 16000
DIGITS = dict(zip("0123456789", ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")))


# Lowercases, splits hyphenated words and strips punctuation so only the spoken words are compared.
def normalize(text):
    text = text.lower().replace("-", " ")
    text = re.sub(r"[^a-z0-9' ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# Decodes any audio file to 16 kHz mono float32 through an ffmpeg pipe (nothing is written to disk).
def load_audio(path):
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    if not raw:
        raise ValueError(f"{path}: ffmpeg decoded no audio")
    return np.frombuffer(raw, dtype=np.float32)


# Loads the openai-whisper model and returns (model name, transcribe function from float32 audio to text).
def load_transcriber():
    import whisper

    model = whisper.load_model("small")

    # Transcribes one clip, settings as in backend/sceneKit/whisperWords.py but without sampling.
    def transcribe(audio):
        result = model.transcribe(audio, language="en", temperature=0.0, condition_on_previous_text=False)
        return result["text"]

    return "small", transcribe


# Spells single digits out and drops apostrophes, so "4" matches "four" and "net's" matches "nets".
def fold(word):
    return DIGITS.get(word, word).replace("'", "")


# Aligns heard words to script words by edit distance. Returns the raw counts (plain WER, as jiwer counts it) and the
# runs of consecutive errors; a run whose letters match the script ("down sampling" for "downsampling", "unet" for
# "U-Net", "4" for "four") is a spelling choice of the speech-to-text, not a misheard word, and is not counted as heard
# wrong.
def word_errors(ref, hyp):
    rows, cols = len(ref) + 1, len(hyp) + 1
    dist = [[0] * cols for _ in range(rows)]
    for i in range(rows):
        dist[i][0] = i
    for j in range(cols):
        dist[0][j] = j
    for i in range(1, rows):
        for j in range(1, cols):
            same = ref[i - 1] == hyp[j - 1]
            dist[i][j] = min(dist[i - 1][j - 1] + (0 if same else 1), dist[i - 1][j] + 1, dist[i][j - 1] + 1)
    ops = []
    i, j = len(ref), len(hyp)
    while i > 0 or j > 0:
        if i > 0 and j > 0 and dist[i][j] == dist[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            ops.append(("ok" if ref[i - 1] == hyp[j - 1] else "sub", ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and dist[i][j] == dist[i - 1][j] + 1:
            ops.append(("del", ref[i - 1], None))
            i -= 1
        else:
            ops.append(("ins", None, hyp[j - 1]))
            j -= 1
    ops.reverse()
    counts = {"sub": 0, "del": 0, "ins": 0}
    misheard = []
    run = []
    for op in ops + [("ok", None, None)]:
        if op[0] != "ok":
            counts[op[0]] += 1
            run.append(op)
            continue
        if run:
            said = [w for _, w, _ in run if w is not None]
            heard = [w for _, _, w in run if w is not None]
            if "".join(map(fold, said)) != "".join(map(fold, heard)):
                misheard.append({"said": " ".join(said), "heard": " ".join(heard), "errors": len(run)})
            run = []
    return {
        "substitutions": counts["sub"],
        "deletions": counts["del"],
        "insertions": counts["ins"],
        "misheard": misheard,
    }


# Parses arguments, transcribes every wav and writes the report. Exits 2 when openai-whisper is not installed.
def main():
    parser = argparse.ArgumentParser(
        description="Transcribe narration wavs and score word error rate against a script."
    )
    parser.add_argument("script")
    parser.add_argument("out")
    parser.add_argument("wavs", nargs="+")
    args = parser.parse_args()

    if importlib.util.find_spec("whisper") is None:
        print(f"no speech-to-text engine: install openai-whisper for {sys.executable}", file=sys.stderr)
        sys.exit(2)

    with open(args.script) as fh:
        ref = normalize(fh.read()).split()
    if not ref:
        raise ValueError(f"{args.script}: the script has no words")
    model_name, transcribe = load_transcriber()
    takes = []
    for wav in args.wavs:
        heard = normalize(transcribe(load_audio(wav)))
        errors = word_errors(ref, heard.split())
        wrong = errors["substitutions"] + errors["deletions"] + errors["insertions"]
        misheard = sum(m["errors"] for m in errors["misheard"])
        takes.append(
            {
                "wav": wav,
                "words": len(ref),
                "wer": round(wrong / len(ref), 4),
                "misheard_rate": round(misheard / len(ref), 4),
                **errors,
                "heard": heard,
            }
        )
    with open(args.out, "w") as fh:
        json.dump({"engine": "whisper", "model": model_name, "takes": takes}, fh, indent=2)


if __name__ == "__main__":
    main()
