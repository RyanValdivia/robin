// Agenda (horario fijo del usuario) — bloques de "estoy ocupado a esa hora",
// distinto de scheduler.ts: esto NUNCA dispara un aviso, no toca BullMQ, es
// solo referencia para una vista de agenda semanal (ver web/components/
// agenda-panel.tsx). Ver db/schema.sql (agenda_blocks) para el porqué de
// day_of_week XOR date.
import { pool } from "../db.ts";

export type AgendaBlock = {
  id: number;
  label: string;
  day_of_week: number | null; // 0=domingo..6=sábado, recurrente semanal
  date: string | null; // fecha puntual (YYYY-MM-DD), no se repite
  start_time: string; // "HH:MM:SS" (formato que devuelve TIME de Postgres)
  end_time: string;
  teacher: string | null; // docente/responsable, opcional
  description: string | null; // notas libres, opcional
};

/** Detalle opcional al crear un bloque — ninguno de los dos es obligatorio. */
export type AgendaBlockExtra = { teacher?: string; description?: string };

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "08:00" válido, "8:00"/"25:00"/"" no — mismo formato que espera la UI y las tools de chat. */
export function isValidHHMM(s: string): boolean {
  return HHMM_RE.test(s);
}

type Recurrence = { dayOfWeek: number } | { date: string };

/** Tira error de validación (mensaje pensado para mostrarse tal cual, a un humano o a Claude). */
export async function addAgendaBlock(
  userId: number,
  label: string,
  startTime: string,
  endTime: string,
  recurrence: Recurrence,
  extra: AgendaBlockExtra = {},
): Promise<number> {
  if (!label.trim()) throw new Error("falta la etiqueta del bloque");
  if (!isValidHHMM(startTime) || !isValidHHMM(endTime)) {
    throw new Error(`hora inválida (usar HH:MM 24h): "${startTime}" / "${endTime}"`);
  }
  if (startTime >= endTime) throw new Error(`start_time (${startTime}) tiene que ser antes que end_time (${endTime})`);

  const dayOfWeek = "dayOfWeek" in recurrence ? recurrence.dayOfWeek : null;
  const date = "date" in recurrence ? recurrence.date : null;
  if (dayOfWeek !== null && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
    throw new Error(`day_of_week inválido (0=domingo..6=sábado): ${dayOfWeek}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO agenda_blocks (user_id, label, day_of_week, date, start_time, end_time, teacher, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      userId,
      label.trim(),
      dayOfWeek,
      date,
      startTime,
      endTime,
      extra.teacher?.trim() || null,
      extra.description?.trim() || null,
    ],
  );
  return rows[0].id as number;
}

export async function removeAgendaBlock(userId: number, id: number): Promise<boolean> {
  const { rows } = await pool.query(`DELETE FROM agenda_blocks WHERE id = $1 AND user_id = $2 RETURNING id`, [
    id,
    userId,
  ]);
  return rows.length > 0;
}

export async function listAgendaBlocks(userId: number): Promise<AgendaBlock[]> {
  // date::text: node-postgres devuelve DATE como Date object por default (medianoche
  // UTC) — al pasar por JSON.stringify corre el riesgo de mostrar el día anterior en
  // timezones negativos. Como string plano "YYYY-MM-DD" no hay conversión de por medio.
  const { rows } = await pool.query<AgendaBlock>(
    `SELECT id, label, day_of_week, date::text AS date, start_time, end_time, teacher, description
     FROM agenda_blocks
     WHERE user_id = $1 ORDER BY COALESCE(day_of_week, EXTRACT(DOW FROM date)::int), start_time`,
    [userId],
  );
  return rows;
}
