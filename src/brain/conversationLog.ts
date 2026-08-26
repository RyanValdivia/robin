// Persistencia de conversaciones/mensajes (gap #1 del análisis de memoria,
// ver memory/projects/robin.md) — Postgres = memoria operacional, columnas
// en el schema desde V1 pero sin código que escribiera ahí; el contexto de
// charla en curso vivía solo en RAM (BrainSession), un restart lo cortaba
// sin dejar rastro. Fire-and-forget en el lado de escritura, mismo criterio
// que usage.ts: un fallo acá nunca rompe una respuesta real al usuario.
import { pool } from "../db.ts";
import type { RouteContext } from "./router.ts";

/**
 * Conversación por (user, channel, external_conversation_id) — upsert
 * idempotente, sobrevive restarts. Exportada (no solo uso interno de
 * logTurn): session.ts la resuelve una vez al crear una BrainSession para
 * ligar tool_audit_log a la conversación real (gap #2 de la segunda tanda,
 * antes quedaba siempre NULL).
 */
export async function getOrCreateConversation(ctx: RouteContext): Promise<number> {
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

/**
 * Historial de burbujas para repoblar el Chat al cargar la página — antes
 * `messages` se escribía (logTurn, abajo) pero nadie lo leía para mostrar:
 * el Chat vivía 100% en estado de React, recargar la página lo vaciaba
 * aunque la sesión de Claude siguiera con toda la memoria (ver session.ts).
 * Trae los últimos `limit` turnos (orden ASC ya armado, no al revés).
 */
export async function getConversationHistory(
  ctx: RouteContext,
  limit = 200,
): Promise<Array<{ role: "user" | "assistant"; text: string; created_at: string }>> {
  const conversationId = await getOrCreateConversation(ctx);
  // logTurn() inserta user+assistant del mismo turno en un solo INSERT ->
  // mismo now(), mismo created_at (Postgres evalúa now() una vez por
  // statement) — sin `id` de desempate, el orden entre esos dos queda
  // indefinido (a veces salía el assistant ANTES que el user que lo generó).
  // `id` sí es secuencial en orden de inserción (SERIAL), por eso desempata bien.
  const { rows } = await pool.query(
    `SELECT role, content->>'text' AS text, created_at FROM (
       SELECT role, content, created_at, id FROM messages
       WHERE conversation_id = $1 AND role IN ('user', 'assistant')
       ORDER BY created_at DESC, id DESC LIMIT $2
     ) recientes ORDER BY created_at ASC, id ASC`,
    [conversationId, limit],
  );
  return rows;
}

// Tope de filas de `messages` por conversación — sin esto la tabla crece
// para siempre (nadie más la poda; el LIMIT de getConversationHistory solo
// filtra qué se MUESTRA, no borra nada). 1000 filas = 500 turnos, bastante
// margen sobre lo que getRecentUserMessages (proactive.ts, resumen semanal,
// hasta 168h) necesita ver hacia atrás.
const MESSAGE_HISTORY_CAP = 1000;

/** Guarda el turno completo (mensaje del usuario + respuesta) de routeMessage() — fire-and-forget. */
export function logTurn(ctx: RouteContext, category: string, userText: string, assistantText: string): void {
  getOrCreateConversation(ctx)
    .then(async (conversationId) => {
      await pool.query(
        `INSERT INTO messages (conversation_id, role, content)
         VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
        [conversationId, JSON.stringify({ text: userText, category }), JSON.stringify({ text: assistantText })],
      );
      await pool.query(
        `DELETE FROM messages WHERE conversation_id = $1 AND id NOT IN (
           SELECT id FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2
         )`,
        [conversationId, MESSAGE_HISTORY_CAP],
      );
    })
    .catch((err) => console.error("[conversationLog] no pude persistir el turno:", err));
}
