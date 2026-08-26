import { NextRequest, NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { listPendingReminders, scheduleReminder, scheduleRecurringReminder } from "@brain/scheduler.ts";

export const runtime = "nodejs";

// Creados acá o desde Telegram, misma tabla — cada uno se entrega por SU
// canal de origen (payload.channel, ver scheduler.ts): los de Telegram por
// Telegram, los de acá por Web (polling, api/web-notifications).
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

// Crear directo desde la Web UI — mismo scheduleReminder()/
// scheduleRecurringReminder() que ya usa el AGENT por chat (schedule_task/
// schedule_recurring_reminder en tools.ts), sin pasar por Claude para
// calcular nada: acá la fecha/cron ya vienen resueltos del formulario.
// channel/externalId fijos en 'web'/'owner' (NO resolveOwnerChannel(), que
// prioriza Telegram si existe) — un recordatorio creado en la Web se entrega
// EN la Web (antes se perdía silenciosamente si se armaba con canal
// Telegram pero nadie miraba ese chat).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "falta texto" }, { status: 400 });

  try {
    const userId = await getOwnerUserId();
    if (!userId) return NextResponse.json({ error: "no hay dueño configurado" }, { status: 400 });

    if (typeof body?.cron_expr === "string" && body.cron_expr.trim()) {
      const id = await scheduleRecurringReminder(userId, "web", "owner", text, body.cron_expr.trim());
      return NextResponse.json({ ok: true, id });
    }

    const runAt = new Date(body?.run_at_iso);
    if (Number.isNaN(runAt.getTime())) {
      return NextResponse.json({ error: "fecha inválida" }, { status: 400 });
    }
    const id = await scheduleReminder(userId, "web", "owner", text, runAt);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[web] error creando recordatorio:", err);
    return NextResponse.json({ error: "no pude crear el recordatorio" }, { status: 500 });
  }
}
