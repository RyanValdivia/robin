# Servicio HTTP interno de transcripción (V6, ver plan) — faster-whisper es
# Python (ctranslate2), separado del proceso Node del brain. Sin puerto
# publicado al host en prod (solo red interna, ver docker-compose.prod.yml);
# el brain lo llama por nombre de servicio ("whisper").
import os
import tempfile

from fastapi import FastAPI, HTTPException, Request
from faster_whisper import WhisperModel

# "small" por default (ver plan, sección Seguridad: controlar tamaño de
# modelos de Whisper, no acumular varios tamaños en disco). int8 en CPU para
# que ande razonable en el VPS (Ampere A1, 4 vCPU ARM) sin GPU.
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
MODEL_CACHE = os.environ.get("WHISPER_CACHE_DIR", "/models")
LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "es")  # "auto" para autodetectar

app = FastAPI()
model: WhisperModel | None = None


@app.on_event("startup")
def load_model() -> None:
    global model
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8", download_root=MODEL_CACHE)


@app.get("/health")
def health():
    return {"status": "ok" if model else "loading", "model": MODEL_SIZE}


@app.post("/transcribe")
async def transcribe(request: Request):
    if model is None:
        raise HTTPException(503, "modelo todavía no cargó")
    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(400, "sin audio en el body")

    with tempfile.NamedTemporaryFile(suffix=".ogg") as f:
        f.write(audio_bytes)
        f.flush()
        segments, info = model.transcribe(
            f.name,
            language=None if LANGUAGE == "auto" else LANGUAGE,
            beam_size=1,
        )
        text = "".join(seg.text for seg in segments).strip()

    return {"text": text, "language": info.language}
