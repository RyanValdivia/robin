// Scheduler (V5, ver plan) — recordatorios/tareas proactivas. No depende de
// Claude para disparar: el worker solo lee scheduled_tasks y empuja el texto
// guardado por el canal de origen. Claude (rama AGENT) solo entra al crear una
// tarea que necesita razonamiento para resolver "cuándo" o "qué" (ver
// schedule_task en brain/tools.ts) — nunca en el momento del disparo.
import IORedis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { REDIS_URL } from "../config.ts";
import { pool } from "../db.ts";
import { sendWebPush } from "./webPush.ts";

// `channels` = a qué canales se manda cuando dispare (independiente del canal
// donde se creó el recordatorio). `channel`/`externalId` quedan solo para leer
// filas viejas (pre-multicanal) — ver worker más abajo.
type ReminderPayload = { channels?: string[]; channel?: string; externalId?: string; text: string };

/** Canales soportados hoy. Default cuando no se especifica: todos. */
export const ALL_CHANNELS = ["web", "telegram"] as const;

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
  channels: readonly string[],
  text: string,
  runAt: Date,
): Promise<number> {
  const payload: ReminderPayload = { channels: [...channels], text };
  const { rows } = await pool.query(
    `INSERT INTO scheduled_tasks (user_id, kind, payload, run_at, status)
     VALUES ($1, 'reminder', $2, $3, 'pending') RETURNING id`,
    [userId, JSON.stringify(payload), runAt],
  );
  const id = rows[0].id as number;
  const delay = Math.max(0, runAt.getTime() - Date.now());
  // BullMQ v6 rechaza ":" en jobId custom ("Custom Id cannot contain :") -> "-".
  // attempts/backoff: sin esto, un error transitorio en el momento del disparo
  // (ej. tabla recién migrada, hiccup de red) mata la entrega para siempre —
  // pasó en vivo (job "task-5" perdido por una carrera con la migración de
  // schema durante un deploy).
  await reminderQueue.add(
    "reminder",
    { taskId: id },
    { delay, jobId: `task-${id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  );
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
  channels: readonly string[],
  text: string,
  cronExpr: string,
  tz = "America/Lima",
): Promise<number> {
  const payload: ReminderPayload = { channels: [...channels], text };
  const { rows } = await pool.query(
    `INSERT INTO scheduled_tasks (user_id, kind, payload, cron_expr, status)
     VALUES ($1, 'recurring_reminder', $2, $3, 'pending') RETURNING id`,
    [userId, JSON.stringify(payload), cronExpr],
  );
  const id = rows[0].id as number;
  // Mismo jobId/schedulerId "task-<id>" que un recordatorio simple, pero es
  // seguro: el id sale de la misma secuencia serial de `scheduled_tasks`, una
  // fila es o 'reminder' o 'recurring_reminder', nunca las dos — no colisiona.
  await reminderQueue.upsertJobScheduler(
    `task-${id}`,
    { pattern: cronExpr, tz },
    { name: "reminder", data: { taskId: id }, opts: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
  );
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
  Array<{ id: number; text: string; run_at: string | null; cron_expr: string | null; channels: string[] }>
> {
  const { rows } = await pool.query(
    `SELECT id, payload, run_at, cron_expr, kind FROM scheduled_tasks
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
      const payload = r.payload as ReminderPayload;
      const channels = payload.channels ?? (payload.channel ? [payload.channel] : ["web"]);
      if (r.kind !== "recurring_reminder") {
        return { id: r.id, text: payload.text, run_at: r.run_at, cron_expr: null, channels };
      }
      const sched = await reminderQueue.getJobScheduler(`task-${r.id}`);
      const next = sched?.next ? new Date(sched.next).toISOString() : null;
      return { id: r.id, text: payload.text, run_at: next, cron_expr: r.cron_expr, channels };
    }),
  );
}

/**
 * Notificaciones de recordatorios del canal 'web' de los últimos 15 minutos —
 * las inserta el worker de abajo (payload.channel === 'web'). NO las marca
 * "consumidas" (a diferencia de una versión anterior que hacía
 * UPDATE...RETURNING): si el dueño tiene la Web abierta en dos pestañas o
 * dispositivos a la vez, cada uno hace su propio polling — consumir en el
 * primer GET que llegara dejaba al resto sin ver la notificación nunca. El
 * dedupe (no mostrar la misma dos veces) queda del lado del cliente, por id
 * (ver chat-panel.tsx) — más simple que coordinar "leído" entre pestañas.
 */
export async function recentWebNotifications(userId: number): Promise<Array<{ id: number; text: string }>> {
  const { rows } = await pool.query<{ id: number; text: string }>(
    `SELECT id, text FROM web_notifications
     WHERE user_id = $1 AND created_at > now() - interval '15 minutes'
     ORDER BY id`,
    [userId],
  );
  return rows;
}

/**
 * Canales a los que HOY se le puede mandar algo a este usuario — 'web'
 * siempre (no depende de vincular nada, usa userId directo), el resto solo
 * si hay una fila en channel_identities. La Web UI la usa para no ofrecer
 * marcar un canal que de todas formas se va a caer en silencio al disparar
 * (ver externalIdFor más abajo).
 */
export async function linkedChannels(userId: number): Promise<string[]> {
  const { rows } = await pool.query<{ channel: string }>(
    `SELECT DISTINCT channel FROM channel_identities WHERE user_id = $1`,
    [userId],
  );
  const linked = new Set(rows.map((r) => r.channel));
  linked.add("web");
  return ALL_CHANNELS.filter((c) => linked.has(c));
}

/** external_id del usuario para un canal dado (ej. chat id de Telegram) — mismo mapeo que auth.ts. */
async function externalIdFor(userId: number, channel: string): Promise<string | null> {
  const { rows } = await pool.query<{ external_id: string }>(
    `SELECT external_id FROM channel_identities WHERE user_id = $1 AND channel = $2 LIMIT 1`,
    [userId, channel],
  );
  return rows[0]?.external_id ?? null;
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
      // Filas viejas (pre-multicanal) solo tienen `channel` — se leen igual.
      const channels = payload.channels ?? (payload.channel ? [payload.channel] : ["web"]);

      // Cada canal se manda por separado con su propio try/catch: si uno
      // falla (ej. Telegram caído) no debe tumbar a los demás, y sobre todo
      // no debe hacer que el job ENTERO reintente — eso repetiría el envío a
      // los canales que sí salieron bien (notificación duplicada). El
      // attempts/backoff de más abajo queda como red para fallas de
      // infraestructura (ej. ni pudo leer `task` de Postgres), no para esto.
      for (const channel of channels) {
        try {
          if (channel === "web") {
            // Web no tiene un sendMessage() como Telegram (registerOutboundSender
            // es una función en memoria del proceso que registra el adapter, y
            // el worker corre en el proceso de Telegram — un "sender" de Web ahí
            // no tendría a quién llamar). En vez de eso, la fila queda para que
            // el navegador la levante por polling (ver api/web-notifications) —
            // fallback que sigue funcionando aunque no haya suscripción de push
            // o esté deshabilitado (sin VAPID_* configuradas).
            await pool.query(`INSERT INTO web_notifications (user_id, text) VALUES ($1, $2)`, [
              task.user_id,
              payload.text,
            ]);
            // Push real (OS-level, funciona con la pestaña/navegador cerrado) —
            // best-effort: si falla o no hay suscripciones, el polling de
            // arriba igual entrega el recordatorio la próxima vez que se abra
            // la Web.
            await sendWebPush(task.user_id, payload.text).catch((err) =>
              console.error("[scheduler] error mandando web push:", err),
            );
            continue;
          }
          // Canal no-web (hoy: telegram) — el external_id se resuelve acá, no
          // al crear el recordatorio, para no depender de dónde se creó (un
          // recordatorio hecho desde la Web igual puede avisar por Telegram).
          // La fila vieja (`payload.externalId`) se reusa solo si coincide con
          // este mismo canal; si no, se busca en channel_identities.
          const legacyExternalId = payload.channel === channel ? (payload.externalId ?? null) : null;
          const resolvedExternalId = legacyExternalId ?? (await externalIdFor(task.user_id, channel));
          if (!resolvedExternalId || !sender) {
            console.error(
              `[scheduler] no puedo mandar por "${channel}": ${!sender ? "sin sender registrado" : "sin external_id vinculado"}`,
            );
            continue;
          }
          await sender(channel, resolvedExternalId, `⏰ ${payload.text}`);
        } catch (err) {
          console.error(`[scheduler] error mandando recordatorio por "${channel}":`, err);
        }
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
