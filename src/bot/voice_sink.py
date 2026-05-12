import asyncio
import logging
import os
import tempfile
import threading
import time
from typing import Optional

import discord
import discord.sinks
import numpy as np

from .voice_buffer import RollingAudioBuffer
from .voice_state import VoiceSessionState

logger = logging.getLogger(__name__)

# Accumulate this many seconds of per-speaker audio before running STT.
# Shorter = more responsive but more CPU. 4 s is a good balance.
DETECTION_WINDOW_SECS = 4.0
SAMPLE_RATE = 48_000
CHANNELS = 2
SAMPLE_WIDTH = 2
BYTES_PER_SEC = SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH          # 192 000
DETECTION_WINDOW_BYTES = int(BYTES_PER_SEC * DETECTION_WINDOW_SECS)  # 768 000

# ------------------------------------------------------------------ #
# Module-level Whisper model singleton                                #
# ------------------------------------------------------------------ #
_whisper_model = None
_whisper_lock = threading.Lock()


def _get_model():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            from faster_whisper import WhisperModel
            logger.info("Loading Whisper tiny/int8 model (first use)…")
            _whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")
            logger.info("Whisper model ready.")
    return _whisper_model


# ------------------------------------------------------------------ #
# Sink                                                                #
# ------------------------------------------------------------------ #

class KeywordDetectionSink(discord.sinks.Sink):
    """
    discord.py AudioSink that:
      1. Pushes every incoming PCM frame into the shared RollingAudioBuffer.
      2. Accumulates per-speaker PCM; every DETECTION_WINDOW_SECS submits a
         transcription job to the thread pool to check for trigger words.
    """

    def __init__(self, state: VoiceSessionState, rolling_buffer: RollingAudioBuffer):
        super().__init__()
        self._state = state
        self._rolling_buffer = rolling_buffer
        # user_id (int) -> bytearray of accumulated PCM
        self._speaker_acc: dict[int, bytearray] = {}
        self._acc_lock = threading.Lock()

    def write(self, data, user) -> None:
        """
        Called by discord.py's voice receive thread for each ~20 ms PCM frame.
        `data` may be raw bytes or an AudioData wrapper depending on discord.py version.
        `user` may be None if the SSRC isn't yet mapped to a Member.
        """
        # Normalise across discord.py versions
        pcm: bytes = data if isinstance(data, (bytes, bytearray)) else getattr(data, "data", b"")
        if not pcm:
            return

        uid: Optional[int] = getattr(user, "id", None)

        # 1. Always push to the global rolling buffer (all speakers mixed)
        self._rolling_buffer.push(pcm)

        # 2. Per-speaker accumulation for STT
        if uid is None:
            return

        with self._acc_lock:
            if uid not in self._speaker_acc:
                self._speaker_acc[uid] = bytearray()
            self._speaker_acc[uid].extend(pcm)

            if len(self._speaker_acc[uid]) < DETECTION_WINDOW_BYTES:
                return

            # Window is full — grab it and reset, keep 1 s of overlap
            window_pcm = bytes(self._speaker_acc[uid])
            keep = int(BYTES_PER_SEC * 1.0)
            self._speaker_acc[uid] = self._speaker_acc[uid][-keep:]

        # Quick pre-flight checks before spending a thread slot
        if self._state.is_on_cooldown():
            return
        if not self._state.get_trigger_words():
            return

        self._state.executor.submit(
            _detect_and_clip, window_pcm, uid, self._state, self._rolling_buffer
        )

    def cleanup(self) -> None:
        with self._acc_lock:
            self._speaker_acc.clear()


# ------------------------------------------------------------------ #
# Worker: runs in ThreadPoolExecutor                                  #
# ------------------------------------------------------------------ #

def _detect_and_clip(
    pcm: bytes,
    user_id: int,
    state: VoiceSessionState,
    rolling_buffer: RollingAudioBuffer,
) -> None:
    """
    Transcribes `pcm` with faster-whisper, checks for trigger words, and if found
    saves a WAV clip and schedules it to be sent on the asyncio event loop.
    Runs entirely in a worker thread — never touches the event loop directly.
    """
    if state.is_on_cooldown():
        return
    trigger_words = state.get_trigger_words()
    if not trigger_words:
        return

    try:
        transcript = _transcribe(pcm)
    except Exception:
        logger.exception("Whisper transcription error")
        return

    if not transcript:
        return

    logger.debug("STT (user %d): %r", user_id, transcript)

    found = next((w for w in trigger_words if w in transcript.lower()), None)
    if found is None:
        return

    # Race-free claim: only the first thread that wins try_start_cooldown proceeds
    if not state.try_start_cooldown():
        return

    logger.info("Trigger '%s' detected from user %d", found, user_id)

    wav = rolling_buffer.snapshot_wav()
    if wav is None:
        logger.warning("Trigger fired but rolling buffer is empty")
        return

    # Save to disk
    os.makedirs(state.clips_dir, exist_ok=True)
    clip_filename = f"clip_{int(time.time())}_{user_id}.wav"
    clip_path = os.path.join(state.clips_dir, clip_filename)
    with open(clip_path, "wb") as fh:
        fh.write(wav)

    clips_channel = state.active_clips_channel
    if state.loop is not None and clips_channel is not None:
        future = asyncio.run_coroutine_threadsafe(
            _send_clip(clips_channel, clip_path, found, state.voice_client),
            state.loop,
        )
        try:
            future.result(timeout=20.0)
        except Exception:
            logger.exception("Failed to send clip to Discord")


def _transcribe(pcm: bytes) -> str:
    """
    Convert raw 48 kHz stereo int16 PCM → 16 kHz mono float32, then transcribe.
    No ffmpeg needed: faster-whisper accepts a numpy array directly.
    """
    arr = np.frombuffer(pcm, dtype=np.int16).reshape(-1, 2)
    mono = arr.mean(axis=1).astype(np.float32) / 32768.0
    # Simple decimation 48 kHz → 16 kHz (factor 3). Acceptable for speech.
    audio_16k = mono[::3]

    model = _get_model()
    segments, _ = model.transcribe(
        audio_16k,
        language="en",
        beam_size=1,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300},
    )
    return " ".join(seg.text for seg in segments).strip()


async def _send_clip(
    channel,
    clip_path: str,
    trigger_word: str,
    voice_client=None,
) -> None:
    try:
        await channel.send(
            content=f"🎬 Trigger word detected: **{trigger_word}** — last 30 seconds:",
            file=discord.File(clip_path),
        )
    except Exception:
        logger.exception("Error sending clip file to Discord channel")

    if voice_client and voice_client.is_connected():
        await _play_tts(voice_client, "Slur has been Clipped")


async def _play_tts(voice_client, text: str) -> None:
    """Generate TTS audio with gTTS and play it through the voice channel."""
    if voice_client.is_playing():
        return

    loop = asyncio.get_running_loop()

    def _generate() -> str:
        from gtts import gTTS
        fp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        gTTS(text=text, lang="en", slow=False).save(fp.name)
        fp.close()
        return fp.name

    try:
        path = await loop.run_in_executor(None, _generate)
    except Exception:
        logger.exception("TTS audio generation failed")
        return

    def _after(error):
        if error:
            logger.error("TTS playback error: %s", error)
        try:
            os.unlink(path)
        except OSError:
            pass

    try:
        voice_client.play(discord.FFmpegOpusAudio(path), after=_after)
    except Exception:
        logger.exception("TTS playback failed")
        try:
            os.unlink(path)
        except OSError:
            pass
