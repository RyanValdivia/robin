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
