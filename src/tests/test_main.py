import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from discord import Message, Embed, Intents
from bot.main import Bot, MessageSender

@pytest.fixture
def discord_client():
    client = MagicMock()
    client.user = AsyncMock()
    client.user.id = 1234  # Mock bot user ID
    return client

@pytest.fixture
def bot():
    with patch("discord.Client", return_value=MagicMock()):
        with patch("bot.main.Bot._get_intents", return_value=Intents.default()):
            return Bot("dummy_token", "admin_id")

@pytest.fixture
def message_sender(discord_client):
    with patch("discord.Client", return_value=discord_client):
        return MessageSender(discord_client)

@pytest.mark.asyncio
async def test_send_message_private():
    # Setup the client and message sender
    client = MagicMock()
    client.user = AsyncMock()
    client.user.id = 1234

    message_sender = MessageSender(client)

    # Mock the author and message
    author = AsyncMock()
    message = AsyncMock()
    message.author = author
    message.channel = None  # Explicitly showing channel is not used in this test

    # Mock the response from your command handler if necessary
    with patch("bot.main.handler.respond", return_value="Test response"):
        await message_sender.send_message(message, "Test command", True)

    # Verify that author.send was awaited with the expected response
    author.send.assert_awaited_with("Test response")

@pytest.mark.asyncio
async def test_send_message_channel():
    # Setup the client and message sender
    client = MagicMock()
    client.user = AsyncMock()
    client.user.id = 1234

    message_sender = MessageSender(client)

    # Mock the channel and message
    channel = AsyncMock()
    message = AsyncMock()
    message.author = channel  # In this context, pretending author is the channel for simplicity
    message.channel = channel

    # Mock the response from your command handler if necessary
    with patch("bot.main.handler.respond", return_value="Test response"):
        await message_sender.send_message(message, "Test command", False)

    # Verify that channel.send was awaited with the expected response
    channel.send.assert_awaited_with("Test response")

@pytest.mark.asyncio
async def test_send_embed_message(message_sender):
    client = MagicMock()
    client.user = AsyncMock()
    client.user.id = 1234

    message_sender = MessageSender(client)

    # Mock the author, channel, and message
    author = AsyncMock()
    channel = AsyncMock()
    message = AsyncMock()
    message.author = author
    message.channel = channel

    # Create a mock Discord Embed
    embed = Embed(title="Test Embed", description="This is a test embed.")

    # Mock the response from your command handler to return an Embed
    with patch("bot.main.handler.respond", return_value=embed):
        await message_sender.send_message(message, "Test command", False)

    # Verify that channel.send was awaited with the expected embed
    channel.send.assert_awaited_with(embed=embed)

@pytest.mark.asyncio
async def test_on_message_ignore_self(bot, discord_client):
    bot.client.user = AsyncMock()
    bot.client.user.id = 12345
    message = AsyncMock(spec=Message)
    message.author = bot.client.user
    with patch.object(bot.message_sender, "send_message", AsyncMock()) as mock_send:
        await bot.on_message(message)
        mock_send.assert_not_awaited()

@pytest.mark.asyncio
async def test_on_message_process(bot, discord_client):
    message = AsyncMock(spec=Message)
    message.content = "!test"
    message.author.id = "admin_id"
    message.author.bot = False
    with patch.object(bot.message_sender, "send_message", AsyncMock()) as mock_send:
        await bot.on_message(message)
        mock_send.assert_awaited_once()

@pytest.mark.asyncio
async def test_on_ready(bot, discord_client):
    bot.client.user = AsyncMock()
    with patch("logging.info") as mock_log:
        await bot.on_ready()
        mock_log.assert_called_with(f"{bot.client.user} has connected to Discord!")

@pytest.mark.asyncio
async def test_run_missing_token_or_admin_id():
    with patch("discord.Client") as mock_client, \
         patch("logging.error") as mock_log:
        Bot(None, None).run()
        mock_log.assert_called()

def test_bot_run_method(bot):
    # Mock the 'run' method of the discord client within our bot instance
    with patch.object(bot.client, 'run') as mock_run:
        # Attempt to run the bot
        bot.run()

        # Assert that 'run' was called once and with the correct token
        mock_run.assert_called_once_with('dummy_token')


@pytest.mark.asyncio
async def test_on_message_voice_routes_to_voice_handler(bot):
    """!voice commands bypass the sync handler and go to voice_handler."""
    message = AsyncMock(spec=Message)
    message.content = "!voice status"
    message.author.id = "admin_id"
    message.author.bot = False
    message.channel = AsyncMock()

    with patch.object(bot.voice_handler, "handle", AsyncMock(return_value="status reply")) as mock_handle:
        await bot.on_message(message)
        mock_handle.assert_awaited_once_with("status", [], message)

    message.channel.send.assert_awaited_once_with("status reply")


@pytest.mark.asyncio
async def test_on_message_voice_subcommand_args_parsed(bot):
    """Arguments after the subcommand are passed correctly."""
    message = AsyncMock(spec=Message)
    message.content = "!voice trigger add slur"
    message.author.id = "admin_id"
    message.author.bot = False
    message.channel = AsyncMock()

    with patch.object(bot.voice_handler, "handle", AsyncMock(return_value="ok")) as mock_handle:
        await bot.on_message(message)
        mock_handle.assert_awaited_once_with("trigger", ["add", "slur"], message)


@pytest.mark.asyncio
async def test_on_message_voice_not_routed_to_sync_handler(bot):
    """!voice commands must NOT reach the sync command handler."""
    message = AsyncMock(spec=Message)
    message.content = "!voice join"
    message.author.id = "admin_id"
    message.author.bot = False
    message.channel = AsyncMock()

    with patch.object(bot.voice_handler, "handle", AsyncMock(return_value="joined")), \
         patch.object(bot.message_sender, "send_message", AsyncMock()) as mock_sync:
        await bot.on_message(message)
        mock_sync.assert_not_awaited()


@pytest.mark.asyncio
async def test_on_voice_state_update_bot_forcibly_removed(bot):
    """When the bot is kicked from a VC, state and buffer are cleaned up."""
    bot.client.user = MagicMock()
    member = bot.client.user       # same object → equality check passes

    before = MagicMock()
    before.channel = MagicMock()   # was in a channel
    after = MagicMock()
    after.channel = None           # now disconnected

    with patch.object(bot.voice_handler.state, "teardown") as mock_teardown, \
         patch.object(bot.voice_handler.buffer, "clear") as mock_clear:
        await bot.on_voice_state_update(member, before, after)
        mock_teardown.assert_called_once()
        mock_clear.assert_called_once()


@pytest.mark.asyncio
async def test_on_voice_state_update_other_member_ignored(bot):
    """Voice state changes for other members must not trigger cleanup."""
    bot.client.user = MagicMock()
    other = MagicMock()            # different object

    before = MagicMock()
    before.channel = MagicMock()
    after = MagicMock()
    after.channel = None

    with patch.object(bot.voice_handler.state, "teardown") as mock_teardown:
        await bot.on_voice_state_update(other, before, after)
        mock_teardown.assert_not_called()


@pytest.mark.asyncio
async def test_on_voice_state_update_bot_channel_change_not_cleanup(bot):
    """Moving between channels (before.channel → after.channel) must not trigger cleanup."""
    bot.client.user = MagicMock()
    member = bot.client.user

    before = MagicMock()
    before.channel = MagicMock()
    after = MagicMock()
    after.channel = MagicMock()    # still connected, just moved

    with patch.object(bot.voice_handler.state, "teardown") as mock_teardown:
        await bot.on_voice_state_update(member, before, after)
        mock_teardown.assert_not_called()


# ------------------------------------------------------------------
# _can_use_voice_commands / open-VC access
# ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_voice_command_accepted_from_vc_side_chat(bot):
    """Non-admin in the VC side chat can issue !voice commands."""
    vc_channel = MagicMock()
    vc_channel.id = 999

    bot.voice_handler.state.voice_client = MagicMock()
    bot.voice_handler.state.voice_client.channel = vc_channel

    message = AsyncMock(spec=Message)
    message.content = "!voice status"
    message.author.id = "other_user"     # not admin
    message.author.bot = False
    message.channel = MagicMock()
    message.channel.id = 999             # same as VC channel

    with patch.object(bot.voice_handler, "handle", AsyncMock(return_value="ok")) as mock_handle:
        await bot.on_message(message)
        mock_handle.assert_awaited_once_with("status", [], message)


@pytest.mark.asyncio
async def test_voice_command_accepted_from_vc_member(bot):
    """Non-admin sitting in the bot's VC can issue !voice commands."""
    vc_channel = MagicMock()
    vc_channel.id = 888

    bot.voice_handler.state.voice_client = MagicMock()
    bot.voice_handler.state.voice_client.channel = vc_channel

    message = AsyncMock(spec=Message)
    message.content = "!voice status"
    message.author.id = "other_user"
    message.author.bot = False
    message.author.voice = MagicMock()
    message.author.voice.channel = MagicMock()
    message.author.voice.channel.id = 888   # author is in the bot's VC
    message.channel = MagicMock()
    message.channel.id = 777               # different text channel

    with patch.object(bot.voice_handler, "handle", AsyncMock(return_value="ok")) as mock_handle:
        await bot.on_message(message)
        mock_handle.assert_awaited_once_with("status", [], message)


@pytest.mark.asyncio
async def test_voice_command_blocked_for_non_vc_user(bot):
    """Non-admin NOT in the bot's VC is silently ignored."""
    vc_channel = MagicMock()
    vc_channel.id = 888

    bot.voice_handler.state.voice_client = MagicMock()
    bot.voice_handler.state.voice_client.channel = vc_channel

    message = AsyncMock(spec=Message)
    message.content = "!voice status"
    message.author.id = "other_user"
    message.author.bot = False
    message.author.voice = None          # not in any VC
    message.channel = MagicMock()
    message.channel.id = 777             # different text channel

    with patch.object(bot.voice_handler, "handle", AsyncMock(return_value="ok")) as mock_handle:
        await bot.on_message(message)
        mock_handle.assert_not_awaited()


@pytest.mark.asyncio
async def test_proxmox_command_still_admin_only(bot):
    """Non-admin cannot reach the Proxmox command handler."""
    message = AsyncMock(spec=Message)
    message.content = "!servers"
    message.author.id = "other_user"
    message.author.bot = False
    message.channel = AsyncMock()

    with patch.object(bot.message_sender, "send_message", AsyncMock()) as mock_sync:
        await bot.on_message(message)
        mock_sync.assert_not_awaited()