import asyncio
import logging
from typing import Optional

import discord

from .voice_buffer import RollingAudioBuffer
from .voice_sink import KeywordDetectionSink
from .voice_state import VoiceSessionState

logger = logging.getLogger(__name__)

_HELP = (
    "```\n"
    "!voice join [channel]           — Join your current VC (or name/ID)\n"
    "!voice leave                    — Leave the VC and stop listening\n"
    "!voice trigger add <word>       — Add a trigger word\n"
    "!voice trigger remove <word>    — Remove a trigger word\n"
    "!voice trigger list             — List all trigger words\n"
    "!voice trigger clear            — Remove all trigger words\n"
    "!voice clipschannel [#channel]  — Set dedicated clips channel (omit to clear)\n"
    "!voice status                   — Show session info\n"
    "!voice cooldown <seconds>       — Set post-trigger cooldown (default 30s)\n"
    "```"
)


class VoiceCommandHandler:
    """
    Handles all `!voice` sub-commands asynchronously.
    Owns the VoiceSessionState and RollingAudioBuffer for the session.
    Instantiated once on the Bot object.
    """

    def __init__(self):
        self.state = VoiceSessionState()
        self.buffer = RollingAudioBuffer(window_seconds=30.0)

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.state.loop = loop

    async def handle(
        self,
        subcommand: str,
        args: list[str],
        message: discord.Message,
    ) -> str:
        dispatch = {
            "join":         self._cmd_join,
            "leave":        self._cmd_leave,
            "trigger":      self._cmd_trigger,
            "clipschannel": self._cmd_clipschannel,
            "status":       self._cmd_status,
            "cooldown":     self._cmd_cooldown,
        }
        fn = dispatch.get(subcommand.lower() if subcommand else "")
        if fn is None:
            return _HELP
        return await fn(args, message)

    # ------------------------------------------------------------------
    # !voice join [channel]
    # ------------------------------------------------------------------

    async def _cmd_join(self, args: list[str], message: discord.Message) -> str:
        if self.state.is_connected():
            return "Already in a voice channel. Use `!voice leave` first."

        channel: Optional[discord.VoiceChannel] = None

        if args:
            if message.guild is None:
                return "This command must be used inside a server."
            for ch in message.guild.voice_channels:
                if ch.name == args[0] or str(ch.id) == args[0]:
                    channel = ch
                    break
            if channel is None:
                return f"Voice channel not found: `{args[0]}`"
        elif message.author.voice and message.author.voice.channel:
            channel = message.author.voice.channel
        else:
            return "You are not in a voice channel. Join one first, or specify a channel name."

        try:
            vc = await channel.connect()
        except discord.ClientException as exc:
            return f"Failed to connect: {exc}"

        self.state.voice_client = vc
        self.state.text_channel = message.channel
        self.buffer.clear()

        sink = KeywordDetectionSink(self.state, self.buffer)
        vc.start_recording(sink, self._on_recording_finished)

        words = self._fmt_words()
        return f"Joined **{channel.name}**. Listening with a 30-second rolling buffer.\nTrigger words: {words}"

    async def _on_recording_finished(self, sink: KeywordDetectionSink, *_) -> None:
        sink.cleanup()
        logger.info("Recording stopped and sink cleaned up.")

    # ------------------------------------------------------------------
    # !voice leave
    # ------------------------------------------------------------------

    async def _cmd_leave(self, args: list[str], message: discord.Message) -> str:
        if not self.state.is_connected():
            return "Not currently in a voice channel."

        vc = self.state.voice_client
        try:
            if vc.recording:
                vc.stop_recording()
            await vc.disconnect()
        except Exception as exc:
            logger.error("Error during disconnect: %s", exc)
        finally:
            self.state.teardown()
            self.buffer.clear()

        return "Left the voice channel and stopped listening."

    # ------------------------------------------------------------------
    # !voice trigger add|remove|list|clear [word]
    # ------------------------------------------------------------------

    async def _cmd_trigger(self, args: list[str], message: discord.Message) -> str:
        if not args:
            return "Usage: `!voice trigger <add|remove|list|clear> [word]`"

        action = args[0].lower()

        if action == "add":
            if len(args) < 2:
                return "Usage: `!voice trigger add <word>`"
            word = args[1].lower().strip()
            if not word.isalpha():
                return "Trigger words must contain only letters (no spaces or punctuation)."
            verb = "Added" if self.state.add_trigger_word(word) else f"`{word}` already listed — no change."
            return f"{verb}\n{self._fmt_words(verbose=True)}"

        if action == "remove":
            if len(args) < 2:
                return "Usage: `!voice trigger remove <word>`"
            word = args[1].lower().strip()
            verb = "Removed" if self.state.remove_trigger_word(word) else f"`{word}` was not in the list — no change."
            return f"{verb}\n{self._fmt_words(verbose=True)}"

        if action == "list":
            return self._fmt_words(verbose=True)

        if action == "clear":
            self.state.set_trigger_words(set())
            return "All trigger words cleared.\n" + self._fmt_words(verbose=True)

        return f"Unknown trigger action: `{action}`. Use `add`, `remove`, `list`, or `clear`."

    # ------------------------------------------------------------------
    # !voice clipschannel [#channel]
    # ------------------------------------------------------------------

    async def _cmd_clipschannel(self, args: list[str], message: discord.Message) -> str:
        if not args:
            self.state.clips_channel = None
            return "Clips channel cleared — clips will go to the channel where `!voice join` was used."

        if message.guild is None:
            return "This command must be used inside a server."

        # Accept a raw mention like <#123456> or a plain name/ID
        raw = args[0].strip("<#>")
        channel = discord.utils.get(message.guild.text_channels, name=raw)
        if channel is None and raw.isdigit():
            channel = message.guild.get_channel(int(raw))  # type: ignore[assignment]
        if channel is None:
            return f"Text channel not found: `{args[0]}`. Use a #mention or exact channel name."

        self.state.clips_channel = channel
        return f"Clips will now be sent to **#{channel.name}**."

    # ------------------------------------------------------------------
    # !voice status
    # ------------------------------------------------------------------

    async def _cmd_status(self, args: list[str], message: discord.Message) -> str:
        connected = self.state.is_connected()
        vc_name = (
            self.state.voice_client.channel.name
            if connected and self.state.voice_client
            else "—"
        )
        clips_ch = self.state.clips_channel
        join_ch = self.state.text_channel
        if clips_ch:
            clips_dest = f"#{clips_ch.name} (dedicated)"
        elif join_ch:
            clips_dest = f"#{join_ch.name} (join channel)"
        else:
            clips_dest = "—"

        return (
            "**Voice Status**\n"
            f"Voice channel : {vc_name}\n"
            f"Clips channel : {clips_dest}\n"
            f"Buffer        : {self.buffer.duration_seconds():.1f}s buffered\n"
            f"Cooldown      : {'Active' if self.state.is_on_cooldown() else 'Ready'} "
            f"({self.state.cooldown_seconds:.0f}s window)\n"
            f"Trigger words : {self._fmt_words()}"
        )

    # ------------------------------------------------------------------
    # !voice cooldown <seconds>
    # ------------------------------------------------------------------

    async def _cmd_cooldown(self, args: list[str], message: discord.Message) -> str:
        if not args:
            return f"Current cooldown: `{self.state.cooldown_seconds:.0f}s`. Usage: `!voice cooldown <seconds>`"
        try:
            seconds = float(args[0])
            if seconds < 0:
                raise ValueError
        except ValueError:
            return "Cooldown must be a non-negative number (seconds)."
        self.state.cooldown_seconds = seconds
        return f"Cooldown set to `{seconds:.0f}s`."

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _fmt_words(self, verbose: bool = False) -> str:
        words = self.state.get_trigger_words()
        if not words:
            return "(none — use `!voice trigger add <word>`)"
        if verbose:
            return "Trigger words:\n" + "\n".join(f"  • `{w}`" for w in sorted(words))
        return ", ".join(f"`{w}`" for w in sorted(words))
