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
  "postgres://jarvis:jarvis_dev_local@localhost:5432/jarvis";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "claude") as
  | "claude"
  | "anthropic-api";

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
