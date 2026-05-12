import io
import threading
import wave
from unittest.mock import patch

import pytest

from bot.voice_buffer import CHANNELS, SAMPLE_RATE, SAMPLE_WIDTH, RollingAudioBuffer


def _pcm(frames: int = 960) -> bytes:
    """Return `frames` frames of silent 16-bit stereo PCM (2 channels × 2 bytes)."""
    return b"\x00\x00\x00\x00" * frames


# ------------------------------------------------------------------
# snapshot_wav on empty / filled buffer
# ------------------------------------------------------------------

def test_empty_buffer_returns_none():
    buf = RollingAudioBuffer(window_seconds=30.0)
    assert buf.snapshot_wav() is None


def test_push_and_snapshot_returns_valid_wav():
    buf = RollingAudioBuffer(window_seconds=30.0)
    buf.push(_pcm(48_000))
    wav = buf.snapshot_wav()
    assert wav is not None
    with wave.open(io.BytesIO(wav)) as wf:
        assert wf.getnchannels() == CHANNELS
        assert wf.getsampwidth() == SAMPLE_WIDTH
        assert wf.getframerate() == SAMPLE_RATE


def test_snapshot_concatenates_all_chunks():
    buf = RollingAudioBuffer(window_seconds=30.0)
    buf.push(_pcm(1_000))
    buf.push(_pcm(2_000))
    wav = buf.snapshot_wav()
    with wave.open(io.BytesIO(wav)) as wf:
        assert wf.getnframes() == 3_000


# ------------------------------------------------------------------
# Eviction
# ------------------------------------------------------------------

def test_eviction_removes_chunks_outside_window():
    buf = RollingAudioBuffer(window_seconds=1.0)
    clock = [0.0]

    with patch("bot.voice_buffer.time.monotonic", side_effect=lambda: clock[0]):
        buf.push(_pcm(100))   # t=0, inside window
        clock[0] = 1.1        # advance past 1 s
        buf.push(_pcm(200))   # t=1.1, evicts the t=0 chunk

    wav = buf.snapshot_wav()
    assert wav is not None
    with wave.open(io.BytesIO(wav)) as wf:
        assert wf.getnframes() == 200


def test_chunks_within_window_are_kept():
    buf = RollingAudioBuffer(window_seconds=5.0)
    clock = [0.0]

    with patch("bot.voice_buffer.time.monotonic", side_effect=lambda: clock[0]):
        buf.push(_pcm(100))
        clock[0] = 2.0
        buf.push(_pcm(100))
        clock[0] = 4.0
        buf.push(_pcm(100))   # all three within 5 s window at t=4

    wav = buf.snapshot_wav()
    with wave.open(io.BytesIO(wav)) as wf:
        assert wf.getnframes() == 300


# ------------------------------------------------------------------
# clear
# ------------------------------------------------------------------

def test_clear_empties_buffer():
    buf = RollingAudioBuffer()
    buf.push(_pcm(100))
    buf.clear()
    assert buf.snapshot_wav() is None


def test_clear_then_push_works():
    buf = RollingAudioBuffer()
    buf.push(_pcm(100))
    buf.clear()
    buf.push(_pcm(50))
    wav = buf.snapshot_wav()
    with wave.open(io.BytesIO(wav)) as wf:
        assert wf.getnframes() == 50


# ------------------------------------------------------------------
# duration_seconds
# ------------------------------------------------------------------

def test_duration_empty_is_zero():
    buf = RollingAudioBuffer()
    assert buf.duration_seconds() == 0.0


def test_duration_single_chunk_is_zero():
    buf = RollingAudioBuffer()
    buf.push(_pcm(100))
    assert buf.duration_seconds() == 0.0


def test_duration_multiple_chunks():
    buf = RollingAudioBuffer(window_seconds=30.0)
    clock = [0.0]

    with patch("bot.voice_buffer.time.monotonic", side_effect=lambda: clock[0]):
        buf.push(_pcm(100))
        clock[0] = 5.0
        buf.push(_pcm(100))

    assert buf.duration_seconds() == pytest.approx(5.0, abs=0.01)


# ------------------------------------------------------------------
# Thread safety
# ------------------------------------------------------------------

def test_concurrent_push_and_snapshot_no_errors():
    buf = RollingAudioBuffer(window_seconds=30.0)
    errors: list = []

    def worker():
        try:
            for _ in range(100):
                buf.push(_pcm(10))
                buf.snapshot_wav()
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], f"Thread-safety violations: {errors}"
