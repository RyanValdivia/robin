import { NextResponse } from "next/server";
import { listNotes } from "@brain/memory.ts";

export const runtime = "nodejs";

// Memoria (vault) — solo lectura acá, escribir sigue siendo cosa de
// remember() desde AGENT (así el índice semántico nunca queda
// desincronizado).
export async function GET() {
  try {
    return NextResponse.json({ notes: listNotes() });
  } catch (err) {
    console.error("[web] error listando memoria:", err);
    return NextResponse.json({ error: "no pude leer la memoria" }, { status: 500 });
  }
}
