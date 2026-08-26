import { NextRequest, NextResponse } from "next/server";
import { removeWebPushSubscription } from "@brain/webPush.ts";

export const runtime = "nodejs";

// El usuario desactiva notificaciones desde la Web UI — borra la fila para
// que sendWebPush() deje de intentarle (si no se borrara, seguiría
// reintentando hasta que el push service devuelva 404/410 solo).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "falta endpoint" }, { status: 400 });

  try {
    await removeWebPushSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[web] error borrando suscripción de push:", err);
    return NextResponse.json({ error: "no pude borrar la suscripción" }, { status: 500 });
  }
}
