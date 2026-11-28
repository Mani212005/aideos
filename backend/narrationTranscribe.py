# File Description: Offline speech-to-text transcription helper for the standing narration pronunciation check. Transcribes a narration WAV file using the locally cached Whisper stack (openai-whisper or faster-whisper, never downloading from the network) and writes the transcript as JSON.
# Inputs and outputs: a narration WAV path and output JSON path -> JSON with engine, model and transcript text (exit 2 when no local Whisper engine is installed).
# Used by: backend/narrationPronunciation.ts (spawned with $AIDEOS_STT_PYTHON or python3).
import importlib.util
import json
import os
import subprocess
import sys

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

SAMPLE_RATE = 16000


# Stops with a one-line error on stderr and the given exit code instead of a Python traceback.
def fail(message: str, code: int = 1) -> None:
    print(f"narrationTranscribe: {message}", file=sys.stderr)
    sys.exit(code)


# Validates CLI arguments before importing any heavy ASR runtime.
def read_arguments(argv: list) -> tuple:
    if len(argv) != 3:
        fail("usage: narrationTranscribe.py <voiceover.wav> <out.json>", 1)
    wav_path, out_path = argv[1], argv[2]
    if not os.path.isfile(wav_path):
        fail(f"audio file not found: {wav_path}", 1)
    out_dir = os.path.dirname(os.path.abspath(out_path))
    if not os.path.isdir(out_dir):
        fail(f"output folder not found: {out_dir}", 1)
    return wav_path, out_path


# Decodes any audio file to 16 kHz mono float32 in memory through an ffmpeg pipe.
def load_audio(wav_path: str):
    import numpy as np

    run = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", wav_path, "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if run.returncode != 0 or not run.stdout:
        fail(f"ffmpeg could not decode {wav_path}: {run.stderr.decode('utf-8', 'replace').strip()}", 1)
    return np.frombuffer(run.stdout, dtype=np.float32)


# Transcribes audio with locally cached openai-whisper or faster-whisper (no network downloads).
def transcribe_offline(audio) -> tuple:
    if importlib.util.find_spec("whisper") is not None:
        import whisper

        model = whisper.load_model("small")
        result = model.transcribe(audio, language="en", temperature=0.0, condition_on_previous_text=False)
        return "openai-whisper", "small", str(result.get("text", "")).strip()

    if importlib.util.find_spec("faster_whisper") is not None:
        from faster_whisper import WhisperModel

        model = WhisperModel("small.en", device="cpu", compute_type="int8", local_files_only=True)
        segments, _ = model.transcribe(
            audio, language="en", beam_size=1, temperature=0.0, condition_on_previous_text=False
        )
        text = " ".join(seg.text.strip() for seg in segments if seg.text).strip()
        return "faster-whisper", "small.en", text

    fail(
        f"no local speech-to-text engine installed for {sys.executable}; install openai-whisper or faster-whisper (or set AIDEOS_STT_PYTHON)",
        2,
    )
    return "", "", ""


# Entry point: validates args, transcribes offline, and writes JSON result.
def main() -> None:
    wav_path, out_path = read_arguments(sys.argv)
    if importlib.util.find_spec("whisper") is None and importlib.util.find_spec("faster_whisper") is None:
        fail(
            f"no local speech-to-text engine installed for {sys.executable}; install openai-whisper or faster-whisper (or set AIDEOS_STT_PYTHON)",
            2,
        )
    audio = load_audio(wav_path)
    engine, model_name, transcript = transcribe_offline(audio)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"engine": engine, "model": model_name, "transcript": transcript}, fh, indent=2)


if __name__ == "__main__":
    main()
