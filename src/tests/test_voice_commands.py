from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest

from bot.voice_commands import VoiceCommandHandler


@pytest.fixture
def handler():
    return VoiceCommandHandler()


@pytest.fixture
def msg():
    """A realistic guild message mock."""
    m = MagicMock(spec=discord.Message)
    m.guild = MagicMock()
    m.guild.voice_channels = []
    m.guild.text_channels = []
    m.guild.get_channel = MagicMock(return_value=None)
    m.author = MagicMock()
    m.author.voice = None
    m.author.bot = False
    m.channel = MagicMock()
    m.channel.send = AsyncMock()
    return m


# ------------------------------------------------------------------
# handle dispatch
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_empty_subcommand_returns_help(handler, msg):
    reply = await handler.handle("", [], msg)
    assert "join" in reply and "trigger" in reply


@pytest.mark.asyncio
async def test_unknown_subcommand_returns_help(handler, msg):
    reply = await handler.handle("badcmd", [], msg)
    assert "join" in reply


# ------------------------------------------------------------------
# !voice join
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_join_already_connected(handler, msg):
    handler.state.voice_client = MagicMock()
    handler.state.voice_client.is_connected.return_value = True
    reply = await handler.handle("join", [], msg)
    assert "already" in reply.lower()


@pytest.mark.asyncio
async def test_join_no_args_and_author_not_in_vc(handler, msg):
    msg.author.voice = None
    reply = await handler.handle("join", [], msg)
    assert "not in a voice channel" in reply.lower()


@pytest.mark.asyncio
async def test_join_with_args_and_no_guild(handler, msg):
    msg.guild = None
    reply = await handler.handle("join", ["General"], msg)
    assert "server" in reply.lower()


@pytest.mark.asyncio
async def test_join_named_channel_not_found(handler, msg):
    msg.guild.voice_channels = []
    reply = await handler.handle("join", ["missing"], msg)
    assert "not found" in reply.lower()


@pytest.mark.asyncio
async def test_join_success_from_author_vc(handler, msg):
    vc_channel = MagicMock()
    vc_channel.name = "Gaming"
    msg.author.voice = MagicMock()
    msg.author.voice.channel = vc_channel

    voice_client = MagicMock()
    voice_client.start_recording = MagicMock()
    vc_channel.connect = AsyncMock(return_value=voice_client)

    reply = await handler.handle("join", [], msg)
    assert "Gaming" in reply
    assert handler.state.voice_client is voice_client
    assert handler.state.text_channel is msg.channel


@pytest.mark.asyncio
async def test_join_success_by_channel_name(handler, msg):
    vc_channel = MagicMock()
    vc_channel.name = "General"
    vc_channel.id = 999
    msg.guild.voice_channels = [vc_channel]

    voice_client = MagicMock()
    voice_client.start_recording = MagicMock()
    vc_channel.connect = AsyncMock(return_value=voice_client)

    reply = await handler.handle("join", ["General"], msg)
    assert "General" in reply


@pytest.mark.asyncio
async def test_join_shows_trigger_words(handler, msg):
    handler.state.add_trigger_word("clip")
    vc_channel = MagicMock()
    vc_channel.name = "General"
    msg.author.voice = MagicMock()
    msg.author.voice.channel = vc_channel

    voice_client = MagicMock()
    voice_client.start_recording = MagicMock()
    vc_channel.connect = AsyncMock(return_value=voice_client)

    reply = await handler.handle("join", [], msg)
    assert "`clip`" in reply


# ------------------------------------------------------------------
# !voice leave
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_leave_when_not_connected(handler, msg):
    reply = await handler.handle("leave", [], msg)
    assert "not currently" in reply.lower()


@pytest.mark.asyncio
async def test_leave_calls_stop_and_disconnect(handler, msg):
    vc = MagicMock()
    vc.is_connected.return_value = True
    vc.recording = MagicMock()
    vc.stop_recording = MagicMock()
    vc.disconnect = AsyncMock()
    handler.state.voice_client = vc

    reply = await handler.handle("leave", [], msg)
    vc.stop_recording.assert_called_once()
    vc.disconnect.assert_awaited_once()
    assert "left" in reply.lower()


@pytest.mark.asyncio
async def test_leave_resets_state(handler, msg):
    vc = MagicMock()
    vc.is_connected.return_value = True
    vc.recording = None
    vc.disconnect = AsyncMock()
    handler.state.voice_client = vc

    await handler.handle("leave", [], msg)
    assert handler.state.voice_client is None


# ------------------------------------------------------------------
# !voice trigger
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_trigger_no_action_shows_usage(handler, msg):
    reply = await handler.handle("trigger", [], msg)
    assert "Usage" in reply


@pytest.mark.asyncio
async def test_trigger_add_new_word(handler, msg):
    reply = await handler.handle("trigger", ["add", "poggers"], msg)
    assert "Added" in reply
    assert "poggers" in handler.state.get_trigger_words()


@pytest.mark.asyncio
async def test_trigger_add_shows_full_list(handler, msg):
    await handler.handle("trigger", ["add", "alpha"], msg)
    reply = await handler.handle("trigger", ["add", "beta"], msg)
    assert "`alpha`" in reply
    assert "`beta`" in reply


@pytest.mark.asyncio
async def test_trigger_add_duplicate_reports_no_change(handler, msg):
    handler.state.add_trigger_word("clip")
    reply = await handler.handle("trigger", ["add", "clip"], msg)
    assert "already listed" in reply


@pytest.mark.asyncio
async def test_trigger_add_non_alpha_rejected(handler, msg):
    reply = await handler.handle("trigger", ["add", "clip123"], msg)
    assert "only letters" in reply.lower()


@pytest.mark.asyncio
async def test_trigger_add_missing_word_shows_usage(handler, msg):
    reply = await handler.handle("trigger", ["add"], msg)
    assert "Usage" in reply


@pytest.mark.asyncio
async def test_trigger_remove_existing_word(handler, msg):
    handler.state.add_trigger_word("clip")
    reply = await handler.handle("trigger", ["remove", "clip"], msg)
    assert "Removed" in reply
    assert "clip" not in handler.state.get_trigger_words()


@pytest.mark.asyncio
async def test_trigger_remove_shows_updated_list(handler, msg):
    handler.state.add_trigger_word("alpha")
    handler.state.add_trigger_word("beta")
    reply = await handler.handle("trigger", ["remove", "alpha"], msg)
    assert "`beta`" in reply


@pytest.mark.asyncio
async def test_trigger_remove_missing_word_arg_shows_usage(handler, msg):
    reply = await handler.handle("trigger", ["remove"], msg)
    assert "Usage" in reply


@pytest.mark.asyncio
async def test_trigger_remove_absent_word_reports_no_change(handler, msg):
    reply = await handler.handle("trigger", ["remove", "ghost"], msg)
    assert "not in the list" in reply


@pytest.mark.asyncio
async def test_trigger_list_empty(handler, msg):
    reply = await handler.handle("trigger", ["list"], msg)
    assert "none" in reply.lower()


@pytest.mark.asyncio
async def test_trigger_list_with_words(handler, msg):
    handler.state.add_trigger_word("alpha")
    handler.state.add_trigger_word("beta")
    reply = await handler.handle("trigger", ["list"], msg)
    assert "`alpha`" in reply
    assert "`beta`" in reply


@pytest.mark.asyncio
async def test_trigger_clear(handler, msg):
    handler.state.add_trigger_word("alpha")
    reply = await handler.handle("trigger", ["clear"], msg)
    assert "cleared" in reply.lower()
    assert handler.state.get_trigger_words() == set()


@pytest.mark.asyncio
async def test_trigger_unknown_action(handler, msg):
    reply = await handler.handle("trigger", ["dance"], msg)
    assert "Unknown" in reply


# ------------------------------------------------------------------
# !voice clipschannel
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_clipschannel_no_args_clears(handler, msg):
    handler.state.clips_channel = MagicMock()
    reply = await handler.handle("clipschannel", [], msg)
    assert handler.state.clips_channel is None
    assert "cleared" in reply.lower()


@pytest.mark.asyncio
async def test_clipschannel_no_guild(handler, msg):
    msg.guild = None
    reply = await handler.handle("clipschannel", ["clips"], msg)
    assert "server" in reply.lower()


@pytest.mark.asyncio
async def test_clipschannel_set_by_name(handler, msg):
    mock_ch = MagicMock()
    mock_ch.name = "clips"
    with patch("discord.utils.get", return_value=mock_ch):
        reply = await handler.handle("clipschannel", ["clips"], msg)
    assert handler.state.clips_channel is mock_ch
    assert "clips" in reply


@pytest.mark.asyncio
async def test_clipschannel_set_by_id(handler, msg):
    mock_ch = MagicMock()
    mock_ch.name = "clips"
    msg.guild.get_channel = MagicMock(return_value=mock_ch)
    with patch("discord.utils.get", return_value=None):
        reply = await handler.handle("clipschannel", ["123456"], msg)
    assert handler.state.clips_channel is mock_ch


@pytest.mark.asyncio
async def test_clipschannel_not_found(handler, msg):
    msg.guild.text_channels = []
    msg.guild.get_channel = MagicMock(return_value=None)
    with patch("discord.utils.get", return_value=None):
        reply = await handler.handle("clipschannel", ["doesntexist"], msg)
    assert "not found" in reply.lower()


# ------------------------------------------------------------------
# !voice status
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_status_not_connected(handler, msg):
    reply = await handler.handle("status", [], msg)
    assert "Voice Status" in reply
    assert "Trigger words" in reply


@pytest.mark.asyncio
async def test_status_shows_dedicated_clips_channel(handler, msg):
    ch = MagicMock()
    ch.name = "clips"
    handler.state.clips_channel = ch
    reply = await handler.handle("status", [], msg)
    assert "clips" in reply
    assert "dedicated" in reply


@pytest.mark.asyncio
async def test_status_shows_join_channel_fallback(handler, msg):
    ch = MagicMock()
    ch.name = "general"
    handler.state.text_channel = ch
    reply = await handler.handle("status", [], msg)
    assert "general" in reply
    assert "join channel" in reply


@pytest.mark.asyncio
async def test_status_shows_trigger_words(handler, msg):
    handler.state.add_trigger_word("poggers")
    reply = await handler.handle("status", [], msg)
    assert "poggers" in reply


@pytest.mark.asyncio
async def test_status_connected(handler, msg):
    vc = MagicMock()
    vc.is_connected.return_value = True
    vc.channel = MagicMock()
    vc.channel.name = "Gaming"
    handler.state.voice_client = vc
    reply = await handler.handle("status", [], msg)
    assert "Gaming" in reply


# ------------------------------------------------------------------
# !voice cooldown
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cooldown_no_arg_shows_current(handler, msg):
    reply = await handler.handle("cooldown", [], msg)
    assert "30" in reply


@pytest.mark.asyncio
async def test_cooldown_set_valid_value(handler, msg):
    reply = await handler.handle("cooldown", ["60"], msg)
    assert handler.state.cooldown_seconds == 60.0
    assert "60" in reply


@pytest.mark.asyncio
async def test_cooldown_set_zero_is_valid(handler, msg):
    reply = await handler.handle("cooldown", ["0"], msg)
    assert handler.state.cooldown_seconds == 0.0


@pytest.mark.asyncio
async def test_cooldown_non_numeric_rejected(handler, msg):
    reply = await handler.handle("cooldown", ["abc"], msg)
    assert "non-negative" in reply.lower()


@pytest.mark.asyncio
async def test_cooldown_negative_rejected(handler, msg):
    reply = await handler.handle("cooldown", ["-5"], msg)
    assert "non-negative" in reply.lower()


# ------------------------------------------------------------------
# _fmt_words helper
# ------------------------------------------------------------------

def test_fmt_words_empty_shows_guidance(handler):
    result = handler._fmt_words()
    assert "none" in result.lower()
    assert "trigger add" in result.lower()


def test_fmt_words_inline_lists_all(handler):
    handler.state.add_trigger_word("alpha")
    handler.state.add_trigger_word("beta")
    result = handler._fmt_words()
    assert "`alpha`" in result
    assert "`beta`" in result


def test_fmt_words_verbose_has_header_and_bullets(handler):
    handler.state.add_trigger_word("alpha")
    result = handler._fmt_words(verbose=True)
    assert "Trigger words" in result
    assert "•" in result
    assert "`alpha`" in result


def test_fmt_words_verbose_sorted(handler):
    handler.state.add_trigger_word("zebra")
    handler.state.add_trigger_word("apple")
    result = handler._fmt_words(verbose=True)
    assert result.index("apple") < result.index("zebra")
