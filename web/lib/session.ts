// Singleton compartido entre las rutas /api/message y /api/voice-message —
// en Express era una sola variable de módulo; acá cada route.ts es su propio
// módulo, así que el singleton vive en un archivo aparte para que ambas
// rutas usen el mismo hilo de conversación.
import { createBrainSession, type BrainSession } from "@brain/session.ts";

let session: BrainSession | null = null;

export function getSession(): BrainSession {
  if (!session) session = createBrainSession();
  return session;
}
