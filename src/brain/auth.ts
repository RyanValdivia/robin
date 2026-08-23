// Auth por canal: channel_identities mapea external_id -> user_id. Solo el
// dueño (is_owner=true) puede usar el bot. Ver plan, sección Seguridad.
import { pool } from "../db.ts";

export async function isOwner(channel: string, externalId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT u.is_owner
     FROM channel_identities ci
     JOIN users u ON u.id = ci.user_id
     WHERE ci.channel = $1 AND ci.external_id = $2`,
    [channel, externalId],
  );
  return rows.length > 0 && rows[0].is_owner === true;
}

/** id de users del dueño — simplificación válida mientras solo hay un owner (ver plan, Seguridad). */
export async function getOwnerUserId(): Promise<number | null> {
  const { rows } = await pool.query(`SELECT id FROM users WHERE is_owner = true ORDER BY id LIMIT 1`);
  return rows[0]?.id ?? null;
}

/**
 * A qué canal empujarle algo al dueño (recordatorio, resumen proactivo).
 * Simplificación válida mientras hay un solo dueño con un solo canal
 * registrado (ver plan, Seguridad) — prioriza Telegram si hay más de uno
 * (hoy: el único canal con push real, ver brain/scheduler.ts).
 */
export async function resolveOwnerChannel(): Promise<{ userId: number; channel: string; externalId: string } | null> {
  const userId = await getOwnerUserId();
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT channel, external_id FROM channel_identities WHERE user_id = $1 ORDER BY (channel = 'telegram') DESC LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return null;
  return { userId, channel: rows[0].channel, externalId: rows[0].external_id };
}
