// Speech-to-text (V6, ver plan) — llama al servicio whisper/ (Python,
// faster-whisper) por HTTP. Separado del proceso Node porque ctranslate2 es
// Python; local y gratis, no toca ninguna API paga.
import { WHISPER_URL } from "../config.ts";

export function sttAvailable(): boolean {
  return WHISPER_URL !== "";
}

export async function transcribeAudio(audio: Buffer): Promise<string> {
  if (!WHISPER_URL) throw new Error("WHISPER_URL no configurado");
  const res = await fetch(`${WHISPER_URL}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    // Uint8Array (no Buffer directo) para que el tipo de fetch() resuelva
    // igual en los dos tsconfig del repo (el del root no tiene lib "dom", el
    // de web/ sí, y cada uno tipa el overload de Buffer distinto). Clips de
    // audio son chicos, la copia no importa.
    body: new Uint8Array(audio),
  });
  if (!res.ok) {
    throw new Error(`whisper respondió ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text.trim();
}
