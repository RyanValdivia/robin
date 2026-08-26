import { NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { recentWebNotifications } from "@brain/scheduler.ts";

export const runtime = "nodejs";

// Canal de entrega propio para recordatorios creados/entregados por Web (ver
// scheduler.ts: el worker inserta en web_notifications cuando
// payload.channel === 'web', en vez de llamar a un sender que no existe para
// este canal — el worker corre en el proceso de Telegram, no en el de Web).
// El frontend (ChatPanel) hace polling acá — devuelve todo lo de los últimos
// 15 minutos, sin "consumir" (varias pestañas/dispositivos pueden estar
// pollingeando a la vez; consumir en el primero dejaba a los demás sin
// verla, ver code review). El dedupe por id queda del lado del cliente.
export async function GET() {
  try {
    const userId = await getOwnerUserId();
    if (!userId) return NextResponse.json({ notifications: [] });
    return NextResponse.json({ notifications: await recentWebNotifications(userId) });
  } catch (err) {
    console.error("[web] error leyendo notificaciones:", err);
    return NextResponse.json({ error: "no pude leer notificaciones" }, { status: 500 });
  }
}
