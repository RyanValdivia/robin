// Agenda (horario fijo del usuario) — bloques de "estoy ocupado a esa hora",
// distinto de scheduler.ts: esto NUNCA dispara un aviso, no toca BullMQ, es
// solo referencia para una vista de agenda semanal (ver web/components/
// agenda-panel.tsx). Ver db/schema.sql (agenda_blocks) para el porqué de
// day_of_week XOR date.
import { pool } from "../db.ts";

export type AgendaCourse = { id: number; name: string; teacher: string | null; color: string };

export type AgendaBlock = {
  id: number;
  label: string;
  day_of_week: number | null; // 0=domingo..6=sábado, recurrente semanal
  date: string | null; // fecha puntual (YYYY-MM-DD), no se repite
  start_time: string; // "HH:MM:SS" (formato que devuelve TIME de Postgres)
  end_time: string;
  teacher: string | null; // docente efectivo (propio del bloque, o heredado del curso)
  description: string | null; // notas libres de ESTE bloque puntual (ej. "traer calculadora")
  course_id: number | null;
  color: string | null; // del curso vinculado — null solo en filas viejas sin curso
};

/** Detalle opcional al crear un bloque — ninguno de los dos es obligatorio. */
export type AgendaBlockExtra = { teacher?: string; description?: string };

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "08:00" válido, "8:00"/"25:00"/"" no — mismo formato que espera la UI y las tools de chat. */
export function isValidHHMM(s: string): boolean {
  return HHMM_RE.test(s);
}

// Paleta categórica validada (skill de dataviz, mismo set que agenda-panel.tsx
// — duplicada a propósito: ese archivo es "use client", no puede importar
// código de server con `pg`). Orden fijo, no ciclado — el color de un curso
// nuevo es el próximo slot libre según cuántos cursos ya tiene el usuario.
const CATEGORY_COLORS = [
  "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767",
];
const OTHER_COLOR = "#8b8a86";

/**
 * Get-or-create por nombre (insensible a mayúsculas) — la pieza que hace que
 * "Cálculo" mencionado en una clase recurrente y después en un examen
 * puntual sea EL MISMO curso, no dos etiquetas parecidas. El match usa
 * unaccent() además de lower() — "Calculo" (sin tilde, typo típico al
 * tipear rápido o por chat) también resuelve al mismo curso que "Cálculo".
 * No es matcheo difuso (no perdona errores de tipeo tipo "Clculo") — eso sí
 * arriesgaría fusionar cursos que en realidad son distintos (ej. "Física I"
 * vs "Física II" son parecidísimos mal comparados). Si ya existe y le pasan
 * un teacher nuevo, lo completa solo si antes no tenía (no pisa un dato ya
 * cargado por una mención ambigua después).
 *
 * Nota de concurrencia: el color se asigna contando filas existentes — con
 * dos altas simultáneas del mismo usuario podrían pisarse el mismo color.
 * Aceptable a esta escala (un solo usuario, altas manuales o por chat, nunca
 * en paralelo de verdad); no vale una transacción/lock para esto.
 */
async function getOrCreateCourse(userId: number, name: string, teacher?: string): Promise<AgendaCourse> {
  const trimmed = name.trim();
  const { rows: existing } = await pool.query<AgendaCourse>(
    `SELECT id, name, teacher, color FROM agenda_courses
     WHERE user_id = $1 AND lower(unaccent(name)) = lower(unaccent($2))`,
    [userId, trimmed],
  );
  if (existing.length > 0) {
    const course = existing[0];
    const newTeacher = teacher?.trim();
    if (newTeacher && !course.teacher) {
      await pool.query(`UPDATE agenda_courses SET teacher = $1 WHERE id = $2`, [newTeacher, course.id]);
      course.teacher = newTeacher;
    }
    return course;
  }
  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM agenda_courses WHERE user_id = $1`,
    [userId],
  );
  const n = Number(countRows[0].count);
  const color = n < CATEGORY_COLORS.length ? CATEGORY_COLORS[n] : OTHER_COLOR;
  const { rows } = await pool.query<AgendaCourse>(
    `INSERT INTO agenda_courses (user_id, name, teacher, color) VALUES ($1, $2, $3, $4)
     RETURNING id, name, teacher, color`,
    [userId, trimmed, teacher?.trim() || null, color],
  );
  return rows[0];
}

export async function listCourses(userId: number): Promise<AgendaCourse[]> {
  const { rows } = await pool.query<AgendaCourse>(
    `SELECT id, name, teacher, color FROM agenda_courses WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
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

  // Mismo label (sin importar mayúsculas) = mismo curso — así una clase
  // recurrente y un examen puntual quedan vinculados solo por escribir el
  // mismo nombre, sin ningún paso extra.
  const course = await getOrCreateCourse(userId, label, extra.teacher);

  const { rows } = await pool.query(
    `INSERT INTO agenda_blocks (user_id, label, day_of_week, date, start_time, end_time, teacher, description, course_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      userId,
      label.trim(),
      dayOfWeek,
      date,
      startTime,
      endTime,
      extra.teacher?.trim() || null,
      extra.description?.trim() || null,
      course.id,
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
  // teacher: COALESCE — el del bloque (si alguien lo pisó puntualmente, ej. un
  // reemplazo solo para el examen) gana sobre el del curso.
  const { rows } = await pool.query<AgendaBlock>(
    `SELECT b.id, b.label, b.day_of_week, b.date::text AS date, b.start_time, b.end_time,
            COALESCE(b.teacher, c.teacher) AS teacher, b.description, b.course_id, c.color
     FROM agenda_blocks b
     LEFT JOIN agenda_courses c ON c.id = b.course_id
     WHERE b.user_id = $1
     ORDER BY COALESCE(b.day_of_week, EXTRACT(DOW FROM b.date)::int), b.start_time`,
    [userId],
  );
  return rows;
}
