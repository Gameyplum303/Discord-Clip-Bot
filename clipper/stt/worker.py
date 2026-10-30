"""Speech-to-text worker for the clipper bot.

Reads one JSON request per line on stdin:
    {"id": 1, "audio": "<base64 16 kHz mono s16le>", "hotwords": "clip"}
and writes one JSON response per line on stdout:
    {"id": 1, "words": [{"word": " clip", "start": 0.42, "end": 0.71}]}

Runs faster-whisper locally on the CPU, so no audio leaves the machine.
"""
import base64
import json
import os
import sys

import numpy as np
from faster_whisper import WhisperModel

MODEL = os.getenv("WHISPER_MODEL", "base.en")
LANGUAGE = os.getenv("WHISPER_LANGUAGE", "en") or None
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
# The bot sends windows of a few seconds; refuse anything far larger.
MAX_AUDIO_SECONDS = 30
MAX_HOTWORDS_CHARS = 2000


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def transcribe(model, req):
    raw = base64.b64decode(req["audio"], validate=True)
    if len(raw) > MAX_AUDIO_SECONDS * 16000 * 2:
        raise ValueError("audio window too long")
    hotwords = req.get("hotwords") or None
    if hotwords is not None and (not isinstance(hotwords, str) or len(hotwords) > MAX_HOTWORDS_CHARS):
        raise ValueError("invalid hotwords")
    audio = np.frombuffer(raw[: len(raw) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = model.transcribe(
        audio,
        language=LANGUAGE,
        beam_size=1,
        word_timestamps=True,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300},
        hotwords=hotwords,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)})
    return words


def main():
    model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
    emit({"ready": True, "model": MODEL})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            emit({"id": req_id, "words": transcribe(model, req)})
        except Exception as exc:  # keep serving after a bad request
            emit({"id": req_id, "error": str(exc)})


if __name__ == "__main__":
    main()
