# Discord Clip Bot

A Discord bot that sits in a voice channel, listens for trigger words you choose, and when someone says one it posts an MP3 of the **10 seconds before and 10 seconds after** the word to a text channel you pick.

Speech recognition runs locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), so voice audio never leaves your machine.

## How it works

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

- **Pick distinctive triggers.** Whisper sometimes mishears short or uncommon words. Words that sound unique ("clip that", "bookmark") work better than very short ones. If a word isn't being picked up, try `WHISPER_MODEL=small.en`.
- **CPU.** `base.en` handles a few people talking at once on a normal desktop CPU. If transcription can't keep up, the bot drops audio windows rather than falling behind and logs a warning.
- **The bot leaves on its own** when everyone else leaves the voice channel.
- **Why Node.js?** Discord now encrypts voice end to end (the DAVE protocol). [`@discordjs/voice`](https://discord.js.org/docs/packages/voice/main) can decrypt received audio, while py-cord's voice receive currently can't, so the clipper is written in Node with a small Python process for Whisper.

## Security and privacy

- **Keep the token secret.** It lives only in `.env`, which is git-ignored. If it ever leaks, reset it in the Developer Portal straight away.
- **Nobody can listen in through the bot.** `/clip join` only works for channels the person running it can see and connect to. `/clip leave` and moving the bot need the same access to the channel it's in, and `/clip status` won't name a channel you can't see.
- **Only admins change settings.** `/clipconfig` needs Manage Server by default. Clips from a private voice channel go wherever the clips channel is, so choose one only the right people can read.
- **Audio stays local.** Speech recognition runs in the container, and the rolling buffer is in memory only and is dropped after 60 seconds. Only triggered clips are saved and posted.
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

### Proxmox bot development

```sh
make test       # run tests in Docker
make lint       # flake8
make format     # black + isort + autopep8
```
