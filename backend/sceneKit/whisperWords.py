# File Description: Transcribes time ranges of a wav with the locally cached openai-whisper model and writes word-level timings as JSON.
# Inputs and outputs: voiceover.wav, a ranges JSON file -> word-level timings JSON.
# Used by: backend/sceneKit/voiceover.ts (spawned with system python3).
#
# Used by the scene kit's voiceover step because the synthesizer's own word offsets are estimates, and a kinetic
# typography film needs each word to land on the frame it is actually spoken. Each line is transcribed on its own clip,
# which keeps whisper from smearing a word across the silence between two lines.
import json
import os
import sys

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

SAMPLE_RATE = 16000


# Stops with a one-line message (exit code 1) instead of a traceback when the arguments or the ranges file are unusable.
def fail(message: str) -> None:
    sys.exit(f"whisperWords: {message}")


# Checks argv and the ranges file before the slow model load; returns (wav_path, ranges, out_path).
def read_arguments(argv: list) -> tuple:
    if len(argv) != 4:
        fail("usage: whisperWords.py <voiceover.wav> <ranges.json> <out.json>")
    wav_path, ranges_path, out_path = argv[1], argv[2], argv[3]
    if not os.path.isfile(wav_path):
        fail(f"audio file not found: {wav_path}")
    if not os.path.isfile(ranges_path):
        fail(f"ranges file not found: {ranges_path}")
    try:
        with open(ranges_path) as fh:
            ranges = json.load(fh)
    except ValueError as err:
        fail(f"ranges file is not valid JSON: {err}")
    if not isinstance(ranges, list):
        fail("ranges file must hold a list of [start, end] pairs")
    for item in ranges:
        ok = (
            isinstance(item, list)
            and len(item) == 2
            and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in item)
        )
        if not ok or not 0 <= item[0] < item[1]:
            fail(f"each range must be [start, end] in seconds with 0 <= start < end, got {item!r}")
    out_dir = os.path.dirname(os.path.abspath(out_path))
    if not os.path.isdir(out_dir):
        fail(f"output folder not found: {out_dir}")
    return wav_path, ranges, out_path


# Reads [[start, end], ...] ranges from argv[2] and writes one list of {word, start, end} per range (absolute seconds).
def main() -> None:
    wav_path, ranges, out_path = read_arguments(sys.argv)
    import whisper  # imported after the argument check, so a bad call fails at once without loading the model stack

    model = whisper.load_model("small")
    audio = whisper.load_audio(wav_path)
    lines = []
    for start, end in ranges:
        clip = audio[int(start * SAMPLE_RATE) : int(end * SAMPLE_RATE)]
        result = model.transcribe(clip, word_timestamps=True, language="en", condition_on_previous_text=False)
        words = []
        for segment in result["segments"]:
            for w in segment.get("words", []):
                words.append(
                    {
                        "word": w["word"].strip(),
                        "start": round(start + float(w["start"]), 3),
                        "end": round(start + float(w["end"]), 3),
                    }
                )
        lines.append(words)
    with open(out_path, "w") as fh:
        json.dump(lines, fh)


if __name__ == "__main__":
    main()
