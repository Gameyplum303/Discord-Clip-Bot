import asyncio
import logging
import discord
import urllib3

from .command_handler import handler
from .message_splitter import DiscordMessageSplitter
from .voice_commands import VoiceCommandHandler

# Setup logging
logging.basicConfig(level=logging.ERROR)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class MessageSender:
    """
    Handles sending messages, abstracting the complexity of dealing with Discord message length limits and splitting logic.
    """
    def __init__(self, client: discord.Client):
        self.client = client

    async def send_message(self, message: discord.Message, user_message: str, is_private: bool) -> None:
        logging.debug(f"Preparing to send a message. Private: {is_private}")
        response = handler.respond(user_message)

        send_func = message.author.send if is_private else message.channel.send

        if isinstance(response, discord.Embed):
            await send_func(embed=response)
        else:
            await self._send_text_response(send_func, response if isinstance(response, str) else "An error occurred.")

    async def _send_text_response(self, send_func, text_response: str):
        splitter = DiscordMessageSplitter()
        chunks = splitter.split_message(text_response)
        for chunk in chunks:
            await send_func(chunk)

class Bot:
    def __init__(self, token: str, admin_id: str):
        self.token = token
        self.admin_id = admin_id
        self.client = discord.Client(intents=self._get_intents())
        self.message_sender = MessageSender(self.client)
        self.voice_handler = VoiceCommandHandler()

        self.client.event(self.on_ready)
        self.client.event(self.on_message)
        self.client.event(self.on_voice_state_update)

    async def on_ready(self):
        logging.info(f"{self.client.user} has connected to Discord!")
        self.voice_handler.set_event_loop(asyncio.get_running_loop())

    async def on_message(self, message: discord.Message):
        if message.author == self.client.user or message.author.bot:
            return
        if not message.content.startswith("!"):
            return

        body = message.content[1:]

        # Voice commands: admin always allowed; anyone in the bot's VC or its
        # side chat is also allowed so the whole channel can interact.
        if body.lower().startswith("voice"):
            if self._can_use_voice_commands(message):
                parts = body.split()
                subcommand = parts[1] if len(parts) > 1 else ""
                args = parts[2:]
                reply = await self.voice_handler.handle(subcommand, args, message)
                await message.channel.send(reply)
            return

        # All other (Proxmox) commands remain admin-only.
        if str(message.author.id) != self.admin_id:
            return

        logging.info(f"Processing admin command: {message.content}")
        await self.message_sender.send_message(message, body, is_private=False)

    def _can_use_voice_commands(self, message: discord.Message) -> bool:
        """Return True if the author may issue !voice commands.

        Allows: the configured admin, anyone sending from the bot's VC side
        chat, and anyone currently sitting in the bot's voice channel.
        """
        if str(message.author.id) == self.admin_id:
            return True
        vc = self.voice_handler.state.voice_client
        if vc and vc.channel:
            # Message sent in the voice channel's own side/text chat
            if message.channel.id == vc.channel.id:
                return True
            # Author is currently in the bot's voice channel
            author_voice = getattr(message.author, "voice", None)
            if author_voice and author_voice.channel and author_voice.channel.id == vc.channel.id:
                return True
        return False

    async def on_voice_state_update(
        self,
        member: discord.Member,
        before: discord.VoiceState,
        after: discord.VoiceState,
    ):
        # If the bot is forcibly removed from a VC, clean up gracefully
        if member == self.client.user and before.channel and not after.channel:
            self.voice_handler.state.teardown()
            self.voice_handler.buffer.clear()

    def _get_intents(self) -> discord.Intents:
        intents = discord.Intents.default()
        intents.messages = True
        intents.message_content = True
        intents.guilds = True
        intents.voice_states = True
        return intents

    def run(self):
        if not self.token or not self.admin_id:
            logging.error("Token or admin ID not provided.")
            return
        self.client.run(self.token)
