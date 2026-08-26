// Persistencia de conversaciones/mensajes (gap #1 del análisis de memoria,
// ver memory/projects/robin.md) — Postgres = memoria operacional, columnas
// en el schema desde V1 pero sin código que escribiera ahí; el contexto de
// charla en curso vivía solo en RAM (BrainSession), un restart lo cortaba
// sin dejar rastro. Fire-and-forget en el lado de escritura, mismo criterio
// que usage.ts: un fallo acá nunca rompe una respuesta real al usuario.
import { pool } from "../db.ts";
import type { RouteContext } from "./router.ts";

/** Conversación por (user, channel, external_conversation_id) — upsert idempotente, sobrevive restarts. */
async function getOrCreateConversation(ctx: RouteContext): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO conversations (user_id, channel, external_conversation_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, channel, external_conversation_id)
     DO UPDATE SET last_active_at = now()
     RETURNING id`,
    [ctx.userId, ctx.channel, ctx.externalId],
  );
  return rows[0].id;
}

/**
 * Mensajes de usuario de las últimas `sinceHours` horas, todos los canales
 * del owner — para que proactive.ts (resumen diario/semanal) pueda revisar
 * qué se habló y proponer remember() de lo que valga la pena (gap #4:
 * memoria pasiva, antes 100% opt-in en caliente). Solo texto (no
 * assistant/category) — lo que dijo el usuario es la señal, no la respuesta.
 */
export async function getRecentUserMessages(userId: number, sinceHours: number): Promise<string[]> {
  const { rows } = await pool.query<{ text: string }>(
    `SELECT m.content->>'text' AS text
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1 AND m.role = 'user' AND m.created_at > now() - ($2 || ' hours')::interval
     ORDER BY m.created_at`,
    [userId, sinceHours],
  );
  return rows.map((r) => r.text).filter((t): t is string => !!t);
}

/** Guarda el turno completo (mensaje del usuario + respuesta) de routeMessage() — fire-and-forget. */
export function logTurn(ctx: RouteContext, category: string, userText: string, assistantText: string): void {
  getOrCreateConversation(ctx)
    .then((conversationId) =>
      pool.query(
        `INSERT INTO messages (conversation_id, role, content)
         VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
        [conversationId, JSON.stringify({ text: userText, category }), JSON.stringify({ text: assistantText })],
      ),
    )
    .catch((err) => console.error("[conversationLog] no pude persistir el turno:", err));
}
