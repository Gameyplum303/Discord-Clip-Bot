# Proxmox VM Manager Bot: A Discord bot for managing Proxmox virtual machines.
# Copyright (C) 2024  Brian J. Royer

# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

# Contact me at: brian.royer@gmail.com or https://github.com/shyce

FROM python:3.12.2-slim

# libopus0: Opus codec for discord.py[voice]
# ffmpeg: required by discord.FFmpegOpusAudio for TTS playback in VC
RUN apt-get update && apt-get install -y \
    make \
    libopus0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY ./src/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install flake8 black isort autopep8 sphinx sphinx-rtd-theme

# Pre-download the Whisper tiny model so the first clip isn't slow
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8')"

COPY ./src /app

CMD ["python", "main.py"]
