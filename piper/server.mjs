// Servicio HTTP interno de síntesis de voz (V6, ver plan) — Piper, local y
// gratis. Sin puerto publicado en prod (solo red interna, ver
// docker-compose.prod.yml); el brain lo llama por nombre de servicio.
//
// Pipeline: Piper escribe PCM crudo a stdout (--output_raw) -> se pipea
// directo a ffmpeg, que lo transcodea a OGG/Opus (lo que Telegram espera
// para mandar una nota de voz de verdad, no un archivo de audio genérico).
// Sin archivos temporales de por medio.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PORT = process.env.PORT ?? 8000;
const PIPER_BIN = process.env.PIPER_BIN ?? "/opt/piper/piper";
const VOICES_DIR = process.env.PIPER_VOICES_DIR ?? "/voices";

// Voz elegida: español mexicano, calidad "high" — no hay voz es_PE en el
// catálogo de Piper; es_MX es el acento latam disponible más neutro para
// oído peruano (vs. es_ES castellano). Ver memoria/projects/robin.md.
const MODEL_NAME = "es_MX-claude-high";
const MODEL_URL_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high";
const MODEL_PATH = `${VOICES_DIR}/${MODEL_NAME}.onnx`;
const CONFIG_PATH = `${VOICES_DIR}/${MODEL_NAME}.onnx.json`;

let sampleRate = 22050; // default razonable si por lo que sea el config no trae el campo

async function downloadIfMissing(url, dest) {
  if (existsSync(dest)) return;
  console.log(`[piper] descargando ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`descarga de ${url} falló: ${res.status}`);
  mkdirSync(VOICES_DIR, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function ensureModel() {
  await downloadIfMissing(`${MODEL_URL_BASE}/${MODEL_NAME}.onnx`, MODEL_PATH);
  await downloadIfMissing(`${MODEL_URL_BASE}/${MODEL_NAME}.onnx.json`, CONFIG_PATH);
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  sampleRate = config.audio?.sample_rate ?? sampleRate;
  console.log(`[piper] modelo listo (${MODEL_NAME}, sample_rate=${sampleRate})`);
}

/** Sintetiza texto -> Buffer de audio OGG/Opus. */
function synthesizeToOgg(text) {
  return new Promise((resolve, reject) => {
    const piper = spawn(PIPER_BIN, ["--model", MODEL_PATH, "--output_raw"]);
    const ffmpeg = spawn("ffmpeg", [
      "-f", "s16le", "-ar", String(sampleRate), "-ac", "1", "-i", "pipe:0",
      "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-f", "ogg", "pipe:1",
    ]);

    piper.stdout.pipe(ffmpeg.stdin);

    let piperErr = "";
    let ffmpegErr = "";
    piper.stderr.on("data", (d) => (piperErr += d));
    ffmpeg.stderr.on("data", (d) => (ffmpegErr += d));

    const chunks = [];
    ffmpeg.stdout.on("data", (d) => chunks.push(d));

    let settled = false;
    piper.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`no pude arrancar piper: ${err.message}`));
    });
    ffmpeg.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`ffmpeg exit ${code}: ${ffmpegErr || piperErr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model: MODEL_NAME }));
    return;
  }

  if (req.method === "POST" && req.url === "/synthesize") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf-8").trim().slice(0, 2000); // tope razonable
    if (!text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "falta texto" }));
      return;
    }
    try {
      const ogg = await synthesizeToOgg(text);
      res.writeHead(200, { "Content-Type": "audio/ogg" });
      res.end(ogg);
    } catch (err) {
      console.error("[piper] error sintetizando:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

ensureModel()
  .then(() => {
    server.listen(PORT, () => console.log(`[piper] listo — escuchando en :${PORT}`));
  })
  .catch((err) => {
    console.error("[piper] no pude preparar el modelo:", err);
    process.exit(1);
  });
