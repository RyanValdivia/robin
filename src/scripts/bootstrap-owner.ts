// Uso: npm run bootstrap-owner -- telegram <external_id> ["Nombre"]
// Crea (si no existe) el user dueño y le linkea una identidad de canal.
import { pool } from "../db.ts";

const [channel, externalId, displayName] = process.argv.slice(2);

if (!channel || !externalId) {
  console.error('Uso: npm run bootstrap-owner -- <channel> <external_id> ["Nombre"]');
  process.exit(1);
}

const { rows: existingOwner } = await pool.query(`SELECT id FROM users WHERE is_owner = true LIMIT 1`);

let userId: number;
if (existingOwner.length > 0) {
  userId = existingOwner[0].id;
} else {
  const { rows } = await pool.query(
    `INSERT INTO users (is_owner, display_name) VALUES (true, $1) RETURNING id`,
    [displayName ?? "owner"],
  );
  userId = rows[0].id;
}

await pool.query(
  `INSERT INTO channel_identities (user_id, channel, external_id)
   VALUES ($1, $2, $3)
   ON CONFLICT (channel, external_id) DO UPDATE SET user_id = excluded.user_id`,
  [userId, channel, externalId],
);

console.log(`Listo: user_id=${userId} vinculado a ${channel}:${externalId}`);
await pool.end();
