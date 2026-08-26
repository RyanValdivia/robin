import { NextRequest, NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { routeMessage, type RouteContext } from "@brain/router.ts";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "falta texto" }, { status: 400 });
  }
  try {
    const userId = await getOwnerUserId();
    const ctx: RouteContext | undefined = userId ? { userId, channel: "web", externalId: "owner" } : undefined;
    const reply = await routeMessage(text, () => getSession(ctx).send(text), ctx);
    return NextResponse.json({ reply: reply || "(sin respuesta)" });
  } catch (err) {
    console.error("[web] error procesando mensaje:", err);
    return NextResponse.json({ error: "tuve un error interno procesando eso" }, { status: 500 });
  }
}
