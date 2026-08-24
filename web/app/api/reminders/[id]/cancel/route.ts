import { NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { cancelReminder } from "@brain/scheduler.ts";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  try {
    const userId = await getOwnerUserId();
    const ok = userId ? await cancelReminder(userId, id) : false;
    if (!ok) {
      return NextResponse.json({ error: "no encontrado o ya no está pendiente" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[web] error cancelando recordatorio:", err);
    return NextResponse.json({ error: "no pude cancelar el recordatorio" }, { status: 500 });
  }
}
