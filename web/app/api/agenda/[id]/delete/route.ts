import { NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { removeAgendaBlock } from "@brain/agenda.ts";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  try {
    const userId = await getOwnerUserId();
    const ok = userId ? await removeAgendaBlock(userId, id) : false;
    if (!ok) {
      return NextResponse.json({ error: "no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[web] error borrando bloque de agenda:", err);
    return NextResponse.json({ error: "no pude borrar el bloque" }, { status: 500 });
  }
}
