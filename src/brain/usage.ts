// Uso/costos (V7, ver plan) — mensajes por rama del router + tokens de Groq,
// para el dashboard de la Web UI. Fire-and-forget en el lado de escritura: un
// fallo acá nunca debe romper una respuesta real al usuario.
import { pool } from "../db.ts";
import type { Category } from "./router.ts";

export function logMessage(category: Category, channel?: string): void {
  pool
    .query(`INSERT INTO message_log (category, channel) VALUES ($1, $2)`, [category, channel ?? null])
    .catch((err) => console.error("[usage] no pude loguear mensaje:", err));
}

export function logGroqUsage(promptTokens: number, completionTokens: number): void {
  pool
    .query(`INSERT INTO groq_usage_log (prompt_tokens, completion_tokens) VALUES ($1, $2)`, [
      promptTokens,
      completionTokens,
    ])
    .catch((err) => console.error("[usage] no pude loguear uso de Groq:", err));
}

export type MessageStats = { category: string; count: number };
export type GroqStats = { calls: number; promptTokens: number; completionTokens: number };

/** sinceDays omitido = histórico completo. */
export async function getMessageStats(sinceDays?: number): Promise<MessageStats[]> {
  const where = sinceDays ? `WHERE created_at > now() - ($1 || ' days')::interval` : "";
  const params = sinceDays ? [sinceDays] : [];
  const { rows } = await pool.query(
    `SELECT category, count(*)::int AS count FROM message_log ${where} GROUP BY category`,
    params,
  );
  return rows;
}

export async function getGroqStats(sinceDays?: number): Promise<GroqStats> {
  const where = sinceDays ? `WHERE created_at > now() - ($1 || ' days')::interval` : "";
  const params = sinceDays ? [sinceDays] : [];
  const { rows } = await pool.query(
    `SELECT count(*)::int AS calls,
            coalesce(sum(prompt_tokens), 0)::int AS "promptTokens",
            coalesce(sum(completion_tokens), 0)::int AS "completionTokens"
     FROM groq_usage_log ${where}`,
    params,
  );
  return rows[0];
}
