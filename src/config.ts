import * as fs from "node:fs";
import * as path from "node:path";

// Node 20.12+/22+ soporta esto nativo; silencioso si .env no existe (ej. VPS con
// las vars ya seteadas por el entorno en vez de un archivo).
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // sin .env — se asume que las vars ya están en el entorno
}

export const ROOT = process.cwd();
export const MEMORY_DIR = path.join(ROOT, "memory");
export const MEMORY_INDEX = path.join(MEMORY_DIR, "MEMORY.md");

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://robin:robin_dev_local@localhost:5432/robin";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "claude") as
  | "claude"
  | "anthropic-api";

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

// LLM barato para las ramas DIRECT/KNOWLEDGE del router (V4) — no toca la
// cuota de Claude. Mismo patrón que LLM_PROVIDER: nombre configurable, no
// hardcodeado a un proveedor.
export const CHEAP_LLM_PROVIDER = (process.env.CHEAP_LLM_PROVIDER ?? "groq") as "groq";
export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";

// STT (V6, ver plan) — servicio HTTP interno de faster-whisper (whisper/).
// Vacío = feature deshabilitada (el adapter avisa en vez de fallar).
export const WHISPER_URL = process.env.WHISPER_URL ?? "";

// TTS (V6, ver plan) — servicio HTTP interno de Piper (piper/). Vacío =
// feature deshabilitada (el adapter simplemente no manda nota de voz).
export const PIPER_URL = process.env.PIPER_URL ?? "";

// Web UI (V7, ver plan) — puerto del servidor Express. Sin auth propia acá:
// en prod queda detrás del middleware tinyauth de Traefik (ver
// docker-compose.prod.yml y src/adapters/web/index.ts).
export const WEB_UI_PORT = Number(process.env.WEB_UI_PORT ?? "3000");

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
