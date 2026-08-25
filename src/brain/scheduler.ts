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

/** El sender ya registrado — lo reusa brain/proactive.ts para el resumen diario/semanal. */
export function getOutboundSender(): OutboundSender | null {
  return sender;
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

/**
 * Programa un recordatorio recurrente — dispara repetido según `cronExpr`
 * (formato cron de 5 campos: minuto hora día-mes mes día-semana, día-semana
 * 0=domingo..6=sábado) hasta que se cancele. A diferencia de un recordatorio
 * simple, la fila en `scheduled_tasks` NO pasa a 'sent' cuando dispara — se
 * queda 'pending' para siempre (es el estado natural de algo recurrente),
 * solo `cancelReminder` la saca de ahí. Mismo mecanismo que los resúmenes
 * diario/semanal de `proactive.ts` (BullMQ `upsertJobScheduler`), pero acá
 * el cron pattern lo define el usuario/Claude, no está fijo en el código.
 */
export async function scheduleRecurringReminder(
  userId: number,
  channel: string,
  externalId: string,
  text: string,
  cronExpr: string,
  tz = "America/Lima",
): Promise<number> {
  const payload: ReminderPayload = { channel, externalId, text };
  const { rows } = await pool.query(
    `INSERT INTO scheduled_tasks (user_id, kind, payload, cron_expr, status)
     VALUES ($1, 'recurring_reminder', $2, $3, 'pending') RETURNING id`,
    [userId, JSON.stringify(payload), cronExpr],
  );
  const id = rows[0].id as number;
  // Mismo jobId/schedulerId "task-<id>" que un recordatorio simple, pero es
  // seguro: el id sale de la misma secuencia serial de `scheduled_tasks`, una
  // fila es o 'reminder' o 'recurring_reminder', nunca las dos — no colisiona.
  await reminderQueue.upsertJobScheduler(`task-${id}`, { pattern: cronExpr, tz }, { name: "reminder", data: { taskId: id } });
  return id;
}

/** Cancela un recordatorio (simple o recurrente) por id — cada uno se saca de BullMQ distinto (job puntual vs. job scheduler). */
export async function cancelReminder(userId: number, taskId: number): Promise<boolean> {
  const { rows: taskRows } = await pool.query(
    `SELECT kind FROM scheduled_tasks WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
    [taskId, userId],
  );
  if (taskRows.length === 0) return false;
  const { rows } = await pool.query(
    `UPDATE scheduled_tasks SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
    [taskId, userId],
  );
  if (rows.length === 0) return false;
  if (taskRows[0].kind === "recurring_reminder") {
    await reminderQueue.removeJobScheduler(`task-${taskId}`);
  } else {
    await reminderQueue.remove(`task-${taskId}`);
  }
  return true;
}

export async function listPendingReminders(userId: number): Promise<
  Array<{ id: number; text: string; run_at: string | null; cron_expr: string | null }>
> {
  const { rows } = await pool.query(
    `SELECT id, payload->>'text' AS text, run_at, cron_expr, kind FROM scheduled_tasks
     WHERE user_id = $1 AND status = 'pending' AND kind IN ('reminder', 'recurring_reminder')
     ORDER BY run_at NULLS LAST`,
    [userId],
  );
  // Para las recurrentes, `run_at` no significa nada (nunca se setea) — el
  // próximo disparo real vive en BullMQ (el scheduler lo recalcula del cron
  // cada vez), no en Postgres. Se completa acá para que la Web UI/tools no
  // tengan que saber de esta diferencia.
  return Promise.all(
    rows.map(async (r) => {
      if (r.kind !== "recurring_reminder") return { id: r.id, text: r.text, run_at: r.run_at, cron_expr: null };
      const sched = await reminderQueue.getJobScheduler(`task-${r.id}`);
      const next = sched?.next ? new Date(sched.next).toISOString() : null;
      return { id: r.id, text: r.text, run_at: next, cron_expr: r.cron_expr };
    }),
  );
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
      // Recurrente: se queda 'pending' — sigue disparando solo hasta que lo
      // cancelen. Solo el recordatorio puntual pasa a 'sent' (dispara una vez).
      if (task.kind !== "recurring_reminder") {
        await pool.query(`UPDATE scheduled_tasks SET status = 'sent' WHERE id = $1`, [task.id]);
      }
    },
    { connection: newConnection() },
  );
  worker.on("failed", (job, err) => {
    console.error(`[scheduler] job ${job?.id} falló:`, err);
  });
  return worker;
}
