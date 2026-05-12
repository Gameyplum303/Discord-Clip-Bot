import collections
import io
import threading
import time
import wave
from typing import Deque, Optional, Tuple

SAMPLE_RATE = 48_000
CHANNELS = 2
SAMPLE_WIDTH = 2  # 16-bit


class RollingAudioBuffer:
    """
    Thread-safe, wall-clock-aware rolling buffer of raw PCM audio.

    Stores (monotonic_timestamp, pcm_bytes) pairs in a deque. Entries older
    than `window_seconds` are evicted on every push, so the buffer always
    represents the most recent window of real elapsed time — silence gaps are
    preserved implicitly because no data is added during them.
    """

    def __init__(self, window_seconds: float = 30.0):
        self._window = window_seconds
        self._lock = threading.Lock()
        self._chunks: Deque[Tuple[float, bytes]] = collections.deque()

    def push(self, pcm: bytes) -> None:
        now = time.monotonic()
        with self._lock:
            self._chunks.append((now, pcm))
            cutoff = now - self._window
            while self._chunks and self._chunks[0][0] < cutoff:
                self._chunks.popleft()

    def snapshot_wav(self) -> Optional[bytes]:
        """Return a WAV-wrapped snapshot of all buffered audio, or None if empty."""
        with self._lock:
            if not self._chunks:
                return None
            pcm_data = b"".join(chunk for _, chunk in self._chunks)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(SAMPLE_WIDTH)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm_data)
        return buf.getvalue()

    def duration_seconds(self) -> float:
        with self._lock:
            if len(self._chunks) < 2:
                return 0.0
            return self._chunks[-1][0] - self._chunks[0][0]

    def clear(self) -> None:
        with self._lock:
            self._chunks.clear()
