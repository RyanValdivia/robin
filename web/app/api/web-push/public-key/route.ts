import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@brain/webPush.ts";

export const runtime = "nodejs";

// El cliente necesita la pública para pushManager.subscribe({applicationServerKey}).
// Vacía si VAPID_* no está configurada — el botón "activar notificaciones"
// de reminders-panel.tsx lo interpreta como "feature no disponible".
export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() });
}
