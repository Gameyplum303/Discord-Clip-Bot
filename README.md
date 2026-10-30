# Discord Clip Bot

A Discord bot that sits in a voice channel, listens for trigger words you choose, and when someone says one it posts an MP3 of the **10 seconds before and 10 seconds after** the word to a text channel you pick.

Speech recognition runs locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), so voice audio never leaves your machine.

Built on earlier open-source work by seanofthewired and Brian Royer. See [Credits](#credits).

![Discord Proxmox Bot](https://i.imgur.com/VjCRZEG.png "Discord Proxmox Bot")

1. `/clip join` connects the bot to your voice channel. It keeps the last 60 seconds of everyone's audio in memory.
2. Each speaker's audio is transcribed in short windows (about every 5 seconds, or as soon as they stop talking). Whisper is given your trigger words as hints, and returns a timestamp for every word.
3. When a trigger word shows up, the bot waits until 10 seconds after the moment it was said, then mixes all speakers from 10 s before to 10 s after into one MP3.
4. The MP3 is posted to your clips channel (and a copy is saved to `./clips/`). A cooldown (15 s by default) stops one moment turning into a pile of clips.

## Setup

### 1. Create the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications), click **New Application**, and give it a name.
2. Open **Bot**, click **Reset Token**, and copy the token. You'll put it in `.env`.
3. No privileged intents are needed: the bot only uses slash commands and voice.
4. Invite it to your server with this link, replacing `YOUR_APPLICATION_ID` (from **General Information**):

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot+applications.commands&permissions=1083392
   ```

   That grants **View Channels**, **Connect**, **Send Messages** and **Attach Files**. Make sure the bot can also see and post in the channel you choose for clips.

### 2. Configure

```sh
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | yes | The bot token from step 1 |
| `COMMAND_GUILD_ID` | no | A server ID to register commands in instantly while testing. Leave empty to register them everywhere. |
| `WHISPER_MODEL` | no | `tiny.en`, `base.en` (default), `small.en` or `medium.en`. Bigger is more accurate but needs more CPU. With Docker, rebuild after changing it. Use a model without `.en` (e.g. `base`) and set `WHISPER_LANGUAGE` for other languages. |
| `WHISPER_LANGUAGE` | no | Language code, default `en` |

### 3. Run with Docker (recommended)

```sh
docker compose up -d --build
docker compose logs -f clipper
```

The image includes ffmpeg, Python and the Whisper model. Settings and a copy of each clip are kept in Docker volumes (`clipper-data`, `clipper-clips`). To copy the saved clips out: `docker compose cp clipper:/app/clips ./clips`.

To use a different Whisper model, set `WHISPER_MODEL` in `.env` and rebuild with `docker compose up -d --build`. The model is baked into the image and the container never downloads anything at runtime.

### Or run without Docker

You need Node.js 22.12+, Python 3.9+ and [ffmpeg](https://ffmpeg.org/download.html) on your `PATH`.

```sh
cd clipper
npm install
python3 -m venv .venv && .venv/bin/pip install -r stt/requirements.txt
export DISCORD_BOT_TOKEN=...            # or load your .env
export PYTHON_PATH=$PWD/.venv/bin/python
npm start
```

The Whisper model downloads on first start.

## Commands

Anyone can use `/clip`. `/clipconfig` needs the **Manage Server** permission by default; you can change who can use it under **Server Settings → Integrations**.

| Command | What it does |
|---|---|
| `/clip join [channel]` | Join your voice channel (or the one you pick) and start listening |
| `/clip leave` | Stop listening and leave |
| `/clip status` | Show the trigger words, clips channel, clip length and cooldown |
| `/clip now` | Save the last 20 seconds right away, no trigger word needed. You need to be in the call. |
| `/clip test` | The bot listens to you for 10 seconds and privately shows what it heard and whether a trigger word would have fired |
| `/clip optout` | The bot never records or transcribes your voice in this server, and drops anything it already had buffered |
| `/clip optin` | Undo `/clip optout` |
| `/clipconfig trigger add <phrase>` | Add a trigger word or short phrase (up to 4 words), e.g. `clip it` |
| `/clipconfig trigger remove <phrase>` | Remove a trigger |
| `/clipconfig trigger list` | List triggers |
| `/clipconfig trigger clear` | Remove all triggers |
| `/clipconfig channel <#channel>` | Text channel the MP3s are posted to. If unset, clips go to the channel `/clip join` was used in. |
| `/clipconfig cooldown <seconds>` | Minimum gap between clips (default 15) |
| `/clipconfig length <before> <after>` | Seconds kept before and after the word (default 10 and 10, up to 30 each) |

Settings are stored per server, so the bot can be used in several servers at once.

### Example

```
/clipconfig trigger add clip that
/clipconfig trigger add no way
/clipconfig channel #clips
/clip join
```

Now when anyone in the call says "clip that" or "no way", a 20-second MP3 shows up in `#clips`.

## Notes and tips

- **Pick distinctive triggers.** Whisper sometimes mishears short or uncommon words. Use `/clip test` to check which words it catches reliably. Words that sound unique ("clip that", "bookmark") work better than very short ones. If a word isn't being picked up, try `WHISPER_MODEL=small.en`.
- **CPU.** `base.en` handles a few people talking at once on a normal desktop CPU. If transcription can't keep up, the bot drops audio windows rather than falling behind and logs a warning.
- **The bot leaves on its own** when everyone else leaves the voice channel.
- **Why Node.js?** Discord now encrypts voice end to end (the DAVE protocol). [`@discordjs/voice`](https://discord.js.org/docs/packages/voice/main) can decrypt received audio, while py-cord's voice receive currently can't, so the clipper is written in Node with a small Python process for Whisper.

## Security and privacy

- **Keep the token secret.** It lives only in `.env`, which is git-ignored. If it ever leaks, reset it in the Developer Portal straight away.
- **Nobody can listen in through the bot.** `/clip join` only works for channels the person running it can see and connect to. `/clip leave` and moving the bot need the same access to the channel it's in, and `/clip status` won't name a channel you can't see. `/clip now` and `/clip test` only work for people in the call, and `/clip test` only shows you your own words.
- **Only admins change settings.** `/clipconfig` needs Manage Server by default. Clips from a private voice channel go wherever the clips channel is, so choose one only the right people can read.
- **Audio stays local.** Speech recognition runs in the container, and the rolling buffer is in memory only and is dropped after 60 seconds. Only triggered clips are saved and posted.
- **Anyone can opt out.** `/clip optout` keeps a person's voice out of all future clips. Their audio isn't kept in the buffer or sent to speech recognition.
- **Tell people they're being recorded.** The bot shows up in the call while it's listening. Make sure everyone in the channel knows it's there and agrees, as recording laws differ by place.
- **The container runs with least privilege.** It runs as a non-root user with a read-only filesystem, all Linux capabilities dropped, `no-new-privileges`, and memory and process limits. It opens no ports.
- **Minimal Discord permissions.** The bot uses no privileged intents and gets only View Channels, Connect, Send Messages and Attach Files. Clip messages never ping anyone.
- **Dependencies are pinned.** npm packages are locked in `package-lock.json` and installed with `npm ci --ignore-scripts`. Check them with `npm audit` (in `clipper/`) and `pip-audit -r clipper/stt/requirements.txt`.

## Development

```sh
cd clipper
npm test
```

Code layout (`clipper/src`):

- `audio-timeline.js`: rolling per-speaker audio buffer, mixes a time range into one track
- `guild-listener.js`: voice connection, speech-recognition windows, trigger handling
- `triggers.js`: trigger normalisation and matching against Whisper word timestamps
- `stt-client.js` + `stt/worker.py`: the Whisper worker process
- `commands.js`: slash commands; `config-store.js`: per-server settings

---

## Optional: Proxmox bot

This repo started as a Discord bot for managing [Proxmox VE](https://www.proxmox.com/) VMs. That bot is still in `src/` and starts only if you ask for it:

```sh
docker compose --profile proxmox up -d --build
```

It needs `PROXMOX_URL`, `PROXMOX_USER`, `PROXMOX_PASS` and `ADMIN_DISCORD_USER_ID` in `.env`, and the **Message Content** intent enabled for the bot. Its older `!voice` clipping commands are superseded by the clipper above; don't use both in the same voice channel.

### Proxmox commands

All commands are prefixed with `!` and restricted to the configured admin user.

#### VM Management

| Command | Description |
|---|---|
| `!vm start <node> <vm>` | Start a VM |
| `!vm stop <node> <vm>` | Stop a VM |
| `!vm reboot <node> <vm>` | Reboot a VM |
| `!vm delete <node> <vm> [--confirmed]` | Delete a VM (requires `--confirmed`) |
| `!vm clone <node> <vm> <new_id> <name> [linked\|full]` | Clone a VM |
| `!vm status <node> <vm>` | Show current power state |
| `!vm info <node> <vm>` | Show full VM config |
| `!vm stats <node> <vm>` | Show CPU and memory usage |
| `!vm ip <node> <vm>` | Show VM IP via QEMU Guest Agent |
| `!vm migrate <node> <vm> <target_node>` | Migrate VM to another node |
| `!vm list_disks <node> <vm>` | List disks and sizes |
| `!vm resize_disk <node> <vm> <disk> <size>` | Resize a disk (e.g. `30G`) |
| `!vm backup <node> <vm> <storage> <backup_id>` | Initiate a backup |
| `!vm restore <node> <backup_file> <storage>` | Restore from backup |
| `!vm list_backups <node> <storage> [vm]` | List backups in a storage |
| `!vms start_all <node>` | Start all VMs on a node |
| `!vms stop_all <node>` | Stop all VMs on a node |

#### Snapshot Management

| Command | Description |
|---|---|
| `!snap create <node> <vm> <name>` | Create a snapshot |
| `!snap list <node> <vm>` | List snapshots |
| `!snap delete <node> <vm> <name>` | Delete a snapshot |
| `!snap rollback <node> <vm> <name>` | Roll back to a snapshot |

#### System Information

| Command | Description |
|---|---|
| `!servers <node>` | List all VMs with status and RAM usage |
| `!node ip <node>` | Show the node's IP address |

#### Session

| Command | Description |
|---|---|
| `!session set_node <node>` | Set a default node for the session (omits `<node>` from subsequent commands) |
| `!session get_node` | Show the current session node |

> `<vm>` accepts either a numeric VM ID or a VM name.

---

## Voice Clipping

The bot can passively listen in a Discord voice channel and automatically clip the last 30 seconds of audio whenever a configured trigger word is spoken. The clip is saved to disk and posted to a Discord text channel. After each clip, the bot also announces the clip aloud in the voice channel using text-to-speech.

### How it works

1. The admin issues `!voice join` — the bot joins the VC and starts a rolling 30-second audio buffer.
2. Speech is continuously transcribed in the background using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (tiny model, CPU, no external API).
3. When any trigger word appears in a transcription, the bot:
   - Saves the last 30 seconds as a WAV file to `./clips/`
   - Posts the WAV to the configured clips channel (or the join channel if none is set)
   - Announces the clip in the VC via gTTS
   - Starts a cooldown period (default 30 s) before the next trigger can fire

### Voice Commands

| Command | Description |
|---|---|
| `!voice join [channel]` | Join your current VC, or a channel by name/ID |
| `!voice leave` | Leave the VC and stop listening |
| `!voice trigger add <word>` | Add a trigger word (letters only) |
| `!voice trigger remove <word>` | Remove a trigger word |
| `!voice trigger list` | List all current trigger words |
| `!voice trigger clear` | Remove all trigger words |
| `!voice clipschannel [#channel]` | Send clips to a dedicated channel (omit to reset to join channel) |
| `!voice status` | Show voice channel, clips channel, buffer depth, cooldown, and trigger words |
| `!voice cooldown <seconds>` | Set the minimum gap between clips (default `30`) |

### Example setup

```
!voice trigger add clip
!voice trigger add highlight
!voice clipschannel #clips
!voice join
```

After this, whenever anyone in the VC says "clip" or "highlight", the bot clips the last 30 seconds and sends it to `#clips`.

### Notes

- Trigger word detection has a ~4 second latency (one transcription window). The full 30-second clip is unaffected — it captures audio up to the moment the word was spoken.
- Clips are also saved to `./clips/` on the host via the Docker volume, so they persist across restarts.
- Silence gaps are preserved in clips; the buffer is wall-clock-time-aware, not based on byte count.
- The Whisper tiny model is baked into the Docker image at build time for fast startup.

---

## Development

```sh
make test       # run tests in Docker
make lint       # flake8
make format     # black + isort + autopep8
```

New commands can be added to `src/bot/commands.py` using the `@command` decorator. Voice commands are handled separately in `src/bot/voice_commands.py` since they require async operations.

---

## Credits

- [ProxmoxBot](https://github.com/seanofthewired/ProxmoxBot) by seanofthewired: the original bot (2023).
- [proxmox-bot](https://github.com/shyce/proxmox-bot) by Brian Royer: refactored command system, Docker setup and test suite (2024).
- Voice clipping (`src/bot/voice_*.py`) by Jared Rogers (2026).

Licensed under the GNU General Public License v3.0. See [COPYING](COPYING).
