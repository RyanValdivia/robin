// Resumen proactivo diario/semanal — combina el scheduler (BullMQ repeatable
// jobs) con la rama AGENT (Claude puede buscar en memoria antes de resumir).
// A diferencia de un recordatorio (brain/scheduler.ts), acá SÍ se llama a
// Claude en el momento del disparo — no hay texto fijo guardado de antemano,
// hay que generarlo. Corre en el mismo proceso que el worker de recordatorios
// (hoy: Telegram) porque reusa su outbound sender.
import IORedis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { REDIS_URL } from "../config.ts";
import { resolveOwnerChannel } from "./auth.ts";
import { listPendingReminders, getOutboundSender } from "./scheduler.ts";
import { createBrainSession } from "./session.ts";

type SummaryKind = "daily" | "weekly";

function newConnection() {
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
}

export const proactiveQueue = new Queue<{ kind: SummaryKind }>("proactive", {
  connection: newConnection(),
});

async function generateSummary(kind: SummaryKind): Promise<string> {
  const owner = await resolveOwnerChannel();
  const reminders = owner ? await listPendingReminders(owner.userId) : [];
  const remindersText =
    reminders.length > 0
      ? reminders
          .map((r) => {
            const when = r.run_at ? new Date(r.run_at).toLocaleString("es-PE", { timeZone: "America/Lima" }) : "?";
            return `- ${r.text} (${r.cron_expr ? `recurrente, próximo ${when}` : when})`;
          })
          .join("\n")
      : "Sin recordatorios pendientes.";

  const periodo = kind === "daily" ? "diario" : "semanal";
  const prompt = `Generá un resumen ${periodo} breve para el usuario, en español, tono natural de
mensaje de buenos días — NO un reporte formal ni una lista burocrática.

Incluí, solo si hay algo que realmente valga la pena (no inventes relleno si no hay nada):
1. Algo relevante de su memoria/proyectos para tener presente (podés usar search_memory si
   te sirve, pero no es obligatorio).
2. Sus recordatorios pendientes:
${remindersText}

3-6 líneas, texto plano.`;

  const session = createBrainSession();
  try {
    return await session.send(prompt);
  } finally {
    session.close();
  }
}

let worker: Worker<{ kind: SummaryKind }> | null = null;

/** Arranca el worker que procesa los resúmenes proactivos. Llamar una vez por proceso. */
export function startProactiveWorker(): Worker<{ kind: SummaryKind }> {
  if (worker) return worker;
  worker = new Worker<{ kind: SummaryKind }>(
    "proactive",
    async (job: Job<{ kind: SummaryKind }>) => {
      const owner = await resolveOwnerChannel();
      const sender = getOutboundSender();
      if (!owner || !sender) {
        console.error("[proactive] no hay canal de dueño u outbound sender registrado — se pierde este resumen");
        return;
      }
      const emoji = job.data.kind === "daily" ? "☀️" : "🗓️";
      let text: string;
      try {
        text = await generateSummary(job.data.kind);
      } catch (err) {
        console.error(`[proactive] error generando resumen ${job.data.kind}:`, err);
        return; // no molestar al usuario con un error de un resumen que ni pidió
      }
      await sender(owner.channel, owner.externalId, `${emoji} ${text}`);
    },
    { connection: newConnection() },
  );
  worker.on("failed", (job, err) => {
    console.error(`[proactive] job ${job?.id} falló:`, err);
  });
  return worker;
}

/**
 * Registra los jobs repetibles (diario 8am, semanal lunes 8am, hora de Lima).
 * `upsertJobScheduler` es idempotente — llamarlo en cada arranque del proceso
 * no duplica nada, solo confirma/actualiza el schedule.
 */
export async function registerProactiveJobs(): Promise<void> {
  await proactiveQueue.upsertJobScheduler(
    "daily-summary",
    { pattern: "0 8 * * *", tz: "America/Lima" },
    { name: "summary", data: { kind: "daily" } },
  );
  await proactiveQueue.upsertJobScheduler(
    "weekly-summary",
    { pattern: "0 8 * * 1", tz: "America/Lima" },
    { name: "summary", data: { kind: "weekly" } },
  );
}
