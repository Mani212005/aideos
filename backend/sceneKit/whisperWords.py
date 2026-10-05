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

import whisper  # noqa: E402

SAMPLE_RATE = 16000


# Reads [[start, end], ...] ranges from argv[2] and writes one list of {word, start, end} per range (absolute seconds).
def main() -> None:
    wav_path, ranges_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(ranges_path) as fh:
        ranges = json.load(fh)
    model = whisper.load_model("small")
    audio = whisper.load_audio(wav_path)
    lines = []
    for start, end in ranges:
        clip = audio[int(start * SAMPLE_RATE) : int(end * SAMPLE_RATE)]
        result = model.transcribe(clip, word_timestamps=True, language="en", condition_on_previous_text=False)
        words = []
        for segment in result["segments"]:
            for w in segment.get("words", []):
                words.append({"word": w["word"].strip(), "start": round(start + float(w["start"]), 3), "end": round(start + float(w["end"]), 3)})
        lines.append(words)
    with open(out_path, "w") as fh:
        json.dump(lines, fh)


if __name__ == "__main__":
    main()
