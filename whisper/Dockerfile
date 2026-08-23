# faster-whisper (ctranslate2) es Python — servicio aparte del brain (Node).
# Nota ARM (ver plan): ctranslate2 tiene wheels oficiales para linux/aarch64,
# pero compute_type="int8" en ARM no está tan probado como en x86 — si falla
# en el VPS, primer fallback es compute_type="int8_float32" o "float32" en
# server.py.
FROM python:3.11-slim

WORKDIR /app

# ffmpeg: faster-whisper decodifica audio vía PyAV — el wheel de av en
# aarch64 puede no traer ffmpeg estático, lo instalamos por las dudas.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# El modelo se descarga la primera vez que arranca y se cachea en un volumen
# (ver docker-compose) — no se vuelve a bajar en cada rebuild/restart.
ENV WHISPER_CACHE_DIR=/models
RUN mkdir -p /models

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
