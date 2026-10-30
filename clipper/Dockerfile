FROM node:22-bookworm-slim

# ffmpeg: MP3 encoding. python3: local Whisper speech recognition.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY stt/requirements.txt stt/requirements.txt
RUN python3 -m venv /opt/stt && /opt/stt/bin/pip install --no-cache-dir -r stt/requirements.txt
ENV PYTHON_PATH=/opt/stt/bin/python

# Download the Whisper model at build time so the bot starts listening straight away.
# Bigger models (small.en, medium.en) are more accurate but slower on CPU.
ARG WHISPER_MODEL=base.en
ENV WHISPER_MODEL=${WHISPER_MODEL} HF_HOME=/opt/hf
RUN if [ "$WHISPER_MODEL" != "none" ]; then \
      /opt/stt/bin/python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['WHISPER_MODEL'], device='cpu', compute_type='int8')"; \
    fi

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src src
COPY stt stt

# Run as the unprivileged "node" user; it only needs to write settings and clips.
RUN mkdir -p /app/data /app/clips && chown node:node /app/data /app/clips
USER node

# The model is baked in above, so never reach out to Hugging Face at runtime.
ENV DATA_DIR=/app/data CLIPS_DIR=/app/clips HF_HUB_OFFLINE=1 NODE_ENV=production
CMD ["node", "src/index.js"]
