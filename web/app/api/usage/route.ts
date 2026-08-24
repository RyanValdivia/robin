import { NextResponse } from "next/server";
import { getMessageStats, getGroqStats } from "@brain/usage.ts";

export const runtime = "nodejs";

// Para el dashboard: mensajes por rama del router (histórico + últimos 30
// días) y tokens de Groq gastados.
export async function GET() {
  try {
    const [messagesAll, messages30d, groqAll, groq30d] = await Promise.all([
      getMessageStats(),
      getMessageStats(30),
      getGroqStats(),
      getGroqStats(30),
    ]);
    return NextResponse.json({ messagesAll, messages30d, groqAll, groq30d });
  } catch (err) {
    console.error("[web] error leyendo uso:", err);
    return NextResponse.json({ error: "no pude leer las estadísticas de uso" }, { status: 500 });
  }
}
