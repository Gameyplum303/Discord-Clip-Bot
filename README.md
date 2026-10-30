# Discord Proxmox Bot

## Overview

A Discord bot that integrates with Proxmox Virtual Environment (PVE) for managing VMs through Discord commands, and passively listens in voice channels to automatically clip audio when trigger words are detected.

Built on earlier open-source work by seanofthewired and Brian Royer. See [Credits](#credits).

![Discord Proxmox Bot](https://i.imgur.com/VjCRZEG.png "Discord Proxmox Bot")

## Prerequisites

- Docker and Docker Compose installed
- Proxmox VE API access
- Discord Bot Token
- Admin Discord User ID

## Configuration

### 1. Docker Compose Setup

Use the provided `compose.yml` to containerize and run the bot. It sets up environment variables, volume bindings for source code, and a `clips/` directory for saved audio clips.

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|---|---|
| `PROXMOX_URL` | URL of your Proxmox VE instance (e.g. `pve.home.arpa`) |
| `PROXMOX_USER` | Proxmox login username (typically `root@pam`) |
| `PROXMOX_PASS` | Proxmox login password |
| `DISCORD_BOT_TOKEN` | Your Discord Bot Token |
| `ADMIN_DISCORD_USER_ID` | Discord User ID of the bot admin |

## Running the Bot

```sh
docker compose up --build
```

The bot will automatically restart unless stopped manually. Audio clips are persisted to `./clips/` on the host.

---

## Proxmox Commands

All commands are prefixed with `!` and restricted to the configured admin user.

### VM Management

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

### Snapshot Management

| Command | Description |
|---|---|
| `!snap create <node> <vm> <name>` | Create a snapshot |
| `!snap list <node> <vm>` | List snapshots |
| `!snap delete <node> <vm> <name>` | Delete a snapshot |
| `!snap rollback <node> <vm> <name>` | Roll back to a snapshot |

### System Information

| Command | Description |
|---|---|
| `!servers <node>` | List all VMs with status and RAM usage |
| `!node ip <node>` | Show the node's IP address |

### Session

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
make coverage   # run tests with coverage report
make lint       # flake8
make format     # black + isort + autopep8
make logs       # tail container logs
```

New commands can be added to `src/bot/commands.py` using the `@command` decorator. Voice commands are handled separately in `src/bot/voice_commands.py` since they require async operations.

---

## Credits

- [ProxmoxBot](https://github.com/seanofthewired/ProxmoxBot) by seanofthewired: the original bot (2023).
- [proxmox-bot](https://github.com/shyce/proxmox-bot) by Brian Royer: refactored command system, Docker setup and test suite (2024).
- Voice clipping (`src/bot/voice_*.py`) by Jared Rogers (2026).

Licensed under the GNU General Public License v3.0. See [COPYING](COPYING).
