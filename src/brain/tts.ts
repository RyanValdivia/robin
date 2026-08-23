// Text-to-speech (V6, ver plan) — llama al servicio piper/ (Piper, local)
// por HTTP. Solo se usa cuando la entrada fue voz (ver adapters/telegram) —
// si el usuario escribió texto, la respuesta sigue siendo solo texto.
import { PIPER_URL } from "../config.ts";

export function ttsAvailable(): boolean {
  return PIPER_URL !== "";
}

/** Devuelve un Buffer de audio OGG/Opus, listo para mandar como nota de voz. */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  if (!PIPER_URL) throw new Error("PIPER_URL no configurado");
  const res = await fetch(`${PIPER_URL}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: text,
  });
  if (!res.ok) {
    throw new Error(`piper respondió ${res.status}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
