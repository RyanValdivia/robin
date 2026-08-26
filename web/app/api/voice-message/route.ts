import { NextRequest, NextResponse } from "next/server";
import { getOwnerUserId } from "@brain/auth.ts";
import { routeMessage, type RouteContext } from "@brain/router.ts";
import { sttAvailable, transcribeAudio } from "@brain/stt.ts";
import { ttsAvailable, synthesizeSpeech } from "@brain/tts.ts";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// Igual que Telegram: se transcribe con whisper/, entra al mismo
// routeMessage(), y si hay TTS configurado la respuesta también viaja como
// audio (base64 en el JSON — clips chicos, no vale la pena un endpoint
// binario aparte).
export async function POST(req: NextRequest) {
  if (!sttAvailable()) {
    return NextResponse.json({ error: "STT no configurado" }, { status: 503 });
  }
  const audio = Buffer.from(await req.arrayBuffer());
  if (audio.length === 0) {
    return NextResponse.json({ error: "falta audio" }, { status: 400 });
  }
  try {
    const transcript = await transcribeAudio(audio);
    if (!transcript) {
      return NextResponse.json({ transcript: "", reply: "No entendí el audio, ¿lo repetís?", audio: null });
    }
    const userId = await getOwnerUserId();
    const ctx: RouteContext | undefined = userId ? { userId, channel: "web", externalId: "owner" } : undefined;
    const reply = await routeMessage(transcript, () => getSession(ctx).send(transcript), ctx);
    let audioBase64: string | null = null;
    if (ttsAvailable() && reply) {
      try {
        audioBase64 = (await synthesizeSpeech(reply)).toString("base64");
      } catch (err) {
        console.error("[web] error generando audio de respuesta:", err);
      }
    }
    return NextResponse.json({ transcript, reply: reply || "(sin respuesta)", audio: audioBase64 });
  } catch (err) {
    console.error("[web] error procesando mensaje de voz:", err);
    return NextResponse.json({ error: "tuve un error interno procesando el audio" }, { status: 500 });
  }
}
