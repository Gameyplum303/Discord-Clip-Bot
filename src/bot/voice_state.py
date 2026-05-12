import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional, Set


class VoiceSessionState:
    """
    Single source of truth for all mutable voice session state.
    Instantiated once on the Bot and passed into the sink and command handler.
    All cross-thread fields are protected by dedicated locks.
    """

    def __init__(self):
        self.voice_client: Optional[Any] = None
        self.text_channel: Optional[Any] = None   # channel where !voice join was issued
        self.clips_channel: Optional[Any] = None  # dedicated clip destination; falls back to text_channel
        self.clips_dir: str = "/app/clips"
        self.cooldown_seconds: float = 30.0
        self.loop: Optional[asyncio.AbstractEventLoop] = None

        self._trigger_words: Set[str] = set()
        self._trigger_lock = threading.Lock()

        self._cooldown_until: float = 0.0
        self._cooldown_lock = threading.Lock()

        self.executor: ThreadPoolExecutor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="stt"
        )

    # ------------------------------------------------------------------
    # Connection helpers
    # ------------------------------------------------------------------

    def is_connected(self) -> bool:
        return self.voice_client is not None and self.voice_client.is_connected()

    # ------------------------------------------------------------------
    # Trigger word management (thread-safe)
    # ------------------------------------------------------------------

    def add_trigger_word(self, word: str) -> bool:
        """Returns True if the word was newly added."""
        word = word.lower().strip()
        with self._trigger_lock:
            if word in self._trigger_words:
                return False
            self._trigger_words.add(word)
            return True

    def remove_trigger_word(self, word: str) -> bool:
        """Returns True if the word existed and was removed."""
        word = word.lower().strip()
        with self._trigger_lock:
            if word not in self._trigger_words:
                return False
            self._trigger_words.discard(word)
            return True

    def set_trigger_words(self, words: Set[str]) -> None:
        with self._trigger_lock:
            self._trigger_words = {w.lower().strip() for w in words}

    def get_trigger_words(self) -> Set[str]:
        with self._trigger_lock:
            return set(self._trigger_words)

    # ------------------------------------------------------------------
    # Cooldown management (thread-safe)
    # ------------------------------------------------------------------

    def is_on_cooldown(self) -> bool:
        with self._cooldown_lock:
            return time.monotonic() < self._cooldown_until

    def try_start_cooldown(self) -> bool:
        """
        Atomically claim the trigger slot. Returns True if this caller won
        the race and should proceed with clipping; False if already cooling down.
        """
        with self._cooldown_lock:
            if time.monotonic() < self._cooldown_until:
                return False
            self._cooldown_until = time.monotonic() + self.cooldown_seconds
            return True

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @property
    def active_clips_channel(self):
        """Returns the dedicated clips channel if set, otherwise the join channel."""
        return self.clips_channel or self.text_channel

    def teardown(self) -> None:
        """Call when disconnecting. Resets connection refs and restarts the executor."""
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="stt")
        self.voice_client = None
        self.text_channel = None
