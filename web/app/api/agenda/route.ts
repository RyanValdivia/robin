import { NextRequest, NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { addAgendaBlock, listAgendaBlocks, listCourses } from "@brain/agenda.ts";

export const runtime = "nodejs";

// `courses` acompaña a `blocks` para que el form de la Web pueda autocompletar
// el label (mismo curso -> mismo color, ver agenda.ts) sin otro round-trip.
export async function GET() {
  try {
    const userId = await getOwnerUserId();
    if (!userId) return NextResponse.json({ blocks: [], courses: [] });
    const [blocks, courses] = await Promise.all([listAgendaBlocks(userId), listCourses(userId)]);
    return NextResponse.json({ blocks, courses });
  } catch (err) {
    console.error("[web] error listando agenda:", err);
    return NextResponse.json({ error: "no pude leer la agenda" }, { status: 500 });
  }
}

// Crear directo desde la Web UI — misma addAgendaBlock() que usa el AGENT
// por chat (add_agenda_block en tools.ts). Sin alerta, sin BullMQ: solo un
// INSERT (ver brain/agenda.ts).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const startTime = typeof body?.start_time === "string" ? body.start_time : "";
  const endTime = typeof body?.end_time === "string" ? body.end_time : "";
  if (!label) return NextResponse.json({ error: "falta la etiqueta" }, { status: 400 });

  const dayOfWeek = typeof body?.day_of_week === "number" ? body.day_of_week : null;
  const date = typeof body?.date === "string" && body.date ? body.date : null;
  if ((dayOfWeek === null) === (date === null)) {
    return NextResponse.json({ error: "mandá exactamente uno de day_of_week o date" }, { status: 400 });
  }
  const teacher = typeof body?.teacher === "string" ? body.teacher : undefined;
  const description = typeof body?.description === "string" ? body.description : undefined;

  try {
    const userId = await getOwnerUserId();
    if (!userId) return NextResponse.json({ error: "no hay dueño configurado" }, { status: 400 });
    const id = await addAgendaBlock(
      userId,
      label,
      startTime,
      endTime,
      dayOfWeek !== null ? { dayOfWeek } : { date: date! },
      { teacher, description },
    );
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "no pude crear el bloque";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
