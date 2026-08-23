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

app.listen(WEB_UI_PORT, () => {
  console.log(`[web] listo — escuchando en :${WEB_UI_PORT}`);
});
