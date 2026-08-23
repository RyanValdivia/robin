// Web UI adapter (V7, ver plan) — chat propio en navegador. Thin: nada de
// lógica de LLM acá, todo pasa por el mismo routeMessage() que Telegram.
//
// Auth: NO hay auth propia en este proceso — se asume que solo tráfico ya
// autenticado llega acá. En prod (docker-compose.prod.yml) el router de
// Traefik para este servicio usa el middleware "tinyauth" (forward-auth) que
// ya protege el resto de servicios admin del VPS (homarr, portainer, el
// dashboard de Traefik) — mismo gate, sin reinventar nada.
//
// Corre como servicio Docker aparte del de Telegram (misma imagen, `command`
// distinto) para no compartir el Worker del scheduler entre dos procesos —
// ver brain/scheduler.ts: solo el proceso de Telegram llama a
// startSchedulerWorker(), así el outbound sender que dispara un recordatorio
// siempre existe. Recordatorios creados desde acá se guardan igual
// (schedule_task / "recordame X"), pero por ahora solo se entregan por
// Telegram — no hay push a browser todavía.
import * as path from "node:path";
import * as url from "node:url";
import express from "express";
import { WEB_UI_PORT } from "../../config.ts";
import { getOwnerUserId } from "../../brain/auth.ts";
import { createBrainSession, type BrainSession } from "../../brain/session.ts";
import { routeMessage } from "../../brain/router.ts";
import { listNotes, readNote } from "../../brain/memory.ts";
import { listPendingReminders, cancelReminder } from "../../brain/scheduler.ts";
import { getMessageStats, getGroqStats } from "../../brain/usage.ts";
import { sttAvailable, transcribeAudio } from "../../brain/stt.ts";
import { ttsAvailable, synthesizeSpeech } from "../../brain/tts.ts";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Un solo usuario, un solo hilo de conversación — a diferencia de Telegram no
// hay chats distintos que separar. Mismo patrón que el CLI.
let session: BrainSession | null = null;
function getSession(): BrainSession {
  if (!session) session = createBrainSession();
  return session;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/message", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "falta texto" });
    return;
  }
  try {
    const userId = await getOwnerUserId();
    const reply = await routeMessage(
      text,
      () => getSession().send(text),
      userId ? { userId, channel: "web", externalId: "owner" } : undefined,
    );
    res.json({ reply: reply || "(sin respuesta)" });
  } catch (err) {
    console.error("[web] error procesando mensaje:", err);
    res.status(500).json({ error: "tuve un error interno procesando eso" });
  }
});

// Voz (V6, ver plan) — igual que Telegram: se transcribe con whisper/, entra
// al mismo routeMessage(), y si hay TTS configurado la respuesta también
// viaja como audio (base64 en el JSON — los clips son chicos, no vale la
// pena un endpoint binario aparte).
app.get("/api/voice-status", (_req, res) => {
  res.json({ stt: sttAvailable(), tts: ttsAvailable() });
});

app.post("/api/voice-message", express.raw({ type: () => true, limit: "15mb" }), async (req, res) => {
  if (!sttAvailable()) {
    res.status(503).json({ error: "STT no configurado" });
    return;
  }
  const audio = req.body as Buffer;
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    res.status(400).json({ error: "falta audio" });
    return;
  }
  try {
    const transcript = await transcribeAudio(audio);
    if (!transcript) {
      res.json({ transcript: "", reply: "No entendí el audio, ¿lo repetís?", audio: null });
      return;
    }
    const userId = await getOwnerUserId();
    const reply = await routeMessage(
      transcript,
      () => getSession().send(transcript),
      userId ? { userId, channel: "web", externalId: "owner" } : undefined,
    );
    let audioBase64: string | null = null;
    if (ttsAvailable() && reply) {
      try {
        audioBase64 = (await synthesizeSpeech(reply)).toString("base64");
      } catch (err) {
        console.error("[web] error generando audio de respuesta:", err);
      }
    }
    res.json({ transcript, reply: reply || "(sin respuesta)", audio: audioBase64 });
  } catch (err) {
    console.error("[web] error procesando mensaje de voz:", err);
    res.status(500).json({ error: "tuve un error interno procesando el audio" });
  }
});

// Memoria (vault) — solo lectura acá, escribir sigue siendo cosa de remember()
// desde AGENT (así el índice semántico nunca queda desincronizado).
app.get("/api/memory", (_req, res) => {
  try {
    res.json({ notes: listNotes() });
  } catch (err) {
    console.error("[web] error listando memoria:", err);
    res.status(500).json({ error: "no pude leer la memoria" });
  }
});

// `path` va como query param (no en la URL en sí) para no depender de la
// sintaxis de wildcards de Express — readNote() igual valida contra la lista
// real de notas del vault, así que un path arbitrario devuelve 404, no lee
// nada fuera de memory/.
app.get("/api/memory/note", (req, res) => {
  const relPath = typeof req.query.path === "string" ? req.query.path : "";
  const content = readNote(relPath);
  if (content === null) {
    res.status(404).json({ error: "nota no encontrada" });
    return;
  }
  res.json({ path: relPath, content });
});

// Recordatorios pendientes. Creados desde acá o desde Telegram, misma tabla —
// pero solo Telegram los entrega cuando disparan (ver comentario arriba).
app.get("/api/reminders", async (_req, res) => {
  try {
    const userId = await getOwnerUserId();
    if (!userId) {
      res.json({ reminders: [] });
      return;
    }
    res.json({ reminders: await listPendingReminders(userId) });
  } catch (err) {
    console.error("[web] error listando recordatorios:", err);
    res.status(500).json({ error: "no pude leer los recordatorios" });
  }
});

app.post("/api/reminders/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  try {
    const userId = await getOwnerUserId();
    const ok = userId ? await cancelReminder(userId, id) : false;
    if (!ok) {
      res.status(404).json({ error: "no encontrado o ya no está pendiente" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[web] error cancelando recordatorio:", err);
    res.status(500).json({ error: "no pude cancelar el recordatorio" });
  }
});

// Uso/costos (V7) — para el dashboard: mensajes por rama del router
// (histórico + últimos 30 días) y tokens de Groq gastados.
app.get("/api/usage", async (_req, res) => {
  try {
    const [messagesAll, messages30d, groqAll, groq30d] = await Promise.all([
      getMessageStats(),
      getMessageStats(30),
      getGroqStats(),
      getGroqStats(30),
    ]);
    res.json({ messagesAll, messages30d, groqAll, groq30d });
  } catch (err) {
    console.error("[web] error leyendo uso:", err);
    res.status(500).json({ error: "no pude leer las estadísticas de uso" });
  }
});

app.listen(WEB_UI_PORT, () => {
  console.log(`[web] listo — escuchando en :${WEB_UI_PORT}`);
});
