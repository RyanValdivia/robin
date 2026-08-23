# TTS (V6, ver plan) — Piper, local y gratis. El release oficial trae el
# binario + sus propias libs (onnxruntime, espeak-ng) todas juntas en una
# carpeta — se copian tal cual, sin separar, porque piper busca
# espeak-ng-data relativo a su propio path.
FROM node:24-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tar ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Multi-arch: el release de Piper resuelve arm64 (VPS) o x86_64 solo.
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in \
         arm64) PIPER_ARCH=aarch64 ;; \
         amd64) PIPER_ARCH=x86_64 ;; \
         *) echo "arch no soportada: $ARCH" && exit 1 ;; \
       esac \
    && curl -sL -o /tmp/piper.tar.gz "https://github.com/rhasspy/piper/releases/latest/download/piper_linux_${PIPER_ARCH}.tar.gz" \
    && tar -xzf /tmp/piper.tar.gz -C /opt \
    && rm /tmp/piper.tar.gz
ENV PIPER_BIN=/opt/piper/piper

COPY server.mjs .

# El modelo de voz (~63MB) se descarga una sola vez al arrancar, a un
# volumen — no infla la imagen ni se vuelve a bajar en cada rebuild (ver
# docker-compose.prod.yml). Mismo patrón que whisper/.
ENV PIPER_VOICES_DIR=/voices
RUN mkdir -p /voices

EXPOSE 8000
CMD ["node", "server.mjs"]
