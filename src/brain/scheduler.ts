// Scheduler (V5, ver plan) — recordatorios/tareas proactivas. No depende de
// Claude para disparar: el worker solo lee scheduled_tasks y empuja el texto
// guardado por el canal de origen. Claude (rama AGENT) solo entra al crear una
// tarea que necesita razonamiento para resolver "cuándo" o "qué" (ver
// schedule_task en brain/tools.ts) — nunca en el momento del disparo.
import IORedis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { REDIS_URL } from "../config.ts";
import { pool } from "../db.ts";

type ReminderPayload = { channel: string; externalId: string; text: string };

// BullMQ exige maxRetriesPerRequest:null para los comandos bloqueantes del
// Worker — conexión aparte de la que usa el resto de la app (src/redis.ts).
function newConnection() {
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
}

export const reminderQueue = new Queue<{ taskId: number }>("reminders", {
  connection: newConnection(),
});

export type OutboundSender = (channel: string, externalId: string, text: string) => Promise<void>;
let sender: OutboundSender | null = null;

/** El adapter que esté vivo (hoy: Telegram) registra cómo mandar el mensaje cuando dispare. */
export function registerOutboundSender(fn: OutboundSender): void {
  sender = fn;
}

/** Programa un recordatorio simple — sin LLM, ni al crear (llamado por el router DIRECT) ni al disparar. */
export async function scheduleReminder(
  userId: number,
  channel: string,
  externalId: string,
  text: string,
  runAt: Date,
): Promise<number> {
  const payload: ReminderPayload = { channel, externalId, text };
  const { rows } = await pool.query(
    `INSERT INTO scheduled_tasks (user_id, kind, payload, run_at, status)
     VALUES ($1, 'reminder', $2, $3, 'pending') RETURNING id`,
    [userId, JSON.stringify(payload), runAt],
  );
  const id = rows[0].id as number;
  const delay = Math.max(0, runAt.getTime() - Date.now());
  // BullMQ v6 rechaza ":" en jobId custom ("Custom Id cannot contain :") -> "-".
  await reminderQueue.add("reminder", { taskId: id }, { delay, jobId: `task-${id}` });
  return id;
}

export async function cancelReminder(userId: number, taskId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE scheduled_tasks SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
    [taskId, userId],
  );
  if (rows.length === 0) return false;
  await reminderQueue.remove(`task-${taskId}`);
  return true;
}

export async function listPendingReminders(
  userId: number,
): Promise<Array<{ id: number; text: string; run_at: string }>> {
  const { rows } = await pool.query(
    `SELECT id, payload->>'text' AS text, run_at FROM scheduled_tasks
     WHERE user_id = $1 AND status = 'pending' AND kind = 'reminder' ORDER BY run_at`,
    [userId],
  );
  return rows;
}

let worker: Worker | null = null;

/** Arranca el worker que procesa recordatorios cuando llega su hora. Llamar una vez por proceso. */
export function startSchedulerWorker(): Worker {
  if (worker) return worker;
  worker = new Worker<{ taskId: number }>(
    "reminders",
    async (job: Job<{ taskId: number }>) => {
      const { rows } = await pool.query(`SELECT * FROM scheduled_tasks WHERE id = $1`, [job.data.taskId]);
      const task = rows[0];
      if (!task || task.status !== "pending") return; // cancelado o ya procesado
      const payload = task.payload as ReminderPayload;
      if (sender) {
        await sender(payload.channel, payload.externalId, `⏰ ${payload.text}`);
      } else {
        console.error("[scheduler] disparó un recordatorio pero no hay outbound sender registrado");
      }
      await pool.query(`UPDATE scheduled_tasks SET status = 'sent' WHERE id = $1`, [task.id]);
    },
    { connection: newConnection() },
  );
  worker.on("failed", (job, err) => {
    console.error(`[scheduler] job ${job?.id} falló:`, err);
  });
  return worker;
}
