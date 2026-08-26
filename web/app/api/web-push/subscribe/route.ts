import { NextRequest, NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { saveWebPushSubscription } from "@brain/webPush.ts";

export const runtime = "nodejs";

// El navegador manda acá el PushSubscription.toJSON() apenas se suscribe
// (ver reminders-panel.tsx). Guardado por endpoint (no por user_id) porque
// un mismo dueño puede tener varias suscripciones activas a la vez —
// ON CONFLICT en saveWebPushSubscription() refresca las keys si el mismo
// endpoint vuelve a suscribirse (ej. el browser las rotó).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "suscripción incompleta" }, { status: 400 });
  }

  try {
    const userId = await getOwnerUserId();
    if (!userId) return NextResponse.json({ error: "no hay dueño configurado" }, { status: 400 });
    await saveWebPushSubscription(userId, { endpoint, keys: { p256dh, auth } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[web] error guardando suscripción de push:", err);
    return NextResponse.json({ error: "no pude guardar la suscripción" }, { status: 500 });
  }
}
