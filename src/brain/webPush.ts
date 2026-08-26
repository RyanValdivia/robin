// Web Push (VAPID) — canal de entrega real para recordatorios del canal
// 'web', complementario al polling de web_notifications (scheduler.ts): ese
// solo funciona con la pestaña de Chat abierta, esto llega como notificación
// del sistema operativo aunque el navegador esté cerrado. Usado tanto por el
// worker (envío, corre en el proceso de Telegram) como por las API routes de
// Next (alta/baja de suscripción, corren en el proceso Web) — mismo patrón
// que el resto de brain/ (una sola fuente de verdad en Postgres).
import webpush from "web-push";
import { pool } from "../db.ts";
import { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } from "../config.ts";

const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);

if (enabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("[webPush] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT no configuradas — push al navegador deshabilitado (queda solo el polling).");
}

/** La pública es la única que necesita el cliente (pushManager.subscribe) — vacía si la feature está deshabilitada. */
export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export type PushSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Alta o refresco de una suscripción (mismo endpoint = mismo browser/perfil, ON CONFLICT actualiza las keys por si rotaron). */
export async function saveWebPushSubscription(userId: number, sub: PushSubscriptionJSON): Promise<void> {
  await pool.query(
    `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
}

/** Baja explícita (el usuario desactiva notificaciones desde la Web UI). */
export async function removeWebPushSubscription(endpoint: string): Promise<void> {
  await pool.query(`DELETE FROM web_push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

/**
 * Manda el push a TODAS las suscripciones del usuario (celu, laptop, varios
 * navegadores). Best-effort por suscripción: una que falla no aborta las
 * demás. 404/410 = el push service dice que ya no existe (usuario
 * desinstaló/revocó permiso) — se borra sola en vez de reintentar para
 * siempre.
 */
export async function sendWebPush(userId: number, text: string): Promise<void> {
  if (!enabled) return;
  const { rows } = await pool.query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM web_push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  const payload = JSON.stringify({ title: "Robin ⏰", body: text });
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await pool.query(`DELETE FROM web_push_subscriptions WHERE endpoint = $1`, [row.endpoint]);
        } else {
          console.error("[webPush] error mandando push:", err);
        }
      }
    }),
  );
}
