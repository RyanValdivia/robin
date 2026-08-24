import { NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { listPendingReminders } from "@brain/scheduler.ts";

export const runtime = "nodejs";

// Creados acá o desde Telegram, misma tabla — pero solo Telegram los
// entrega cuando disparan (ver comentario en brain/scheduler.ts).
export async function GET() {
  try {
    const userId = await getOwnerUserId();
    if (!userId) return NextResponse.json({ reminders: [] });
    return NextResponse.json({ reminders: await listPendingReminders(userId) });
  } catch (err) {
    console.error("[web] error listando recordatorios:", err);
    return NextResponse.json({ error: "no pude leer los recordatorios" }, { status: 500 });
  }
}
