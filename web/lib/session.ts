// Singleton compartido entre las rutas /api/message y /api/voice-message —
// en Express era una sola variable de módulo; acá cada route.ts es su propio
// módulo, así que el singleton vive en un archivo aparte para que ambas
// rutas usen el mismo hilo de conversación.
import { createBrainSession, type BrainSession } from "@brain/session.ts";
import type { RouteContext } from "@brain/router.ts";

let session: BrainSession | null = null;

// `ctx` solo importa en la creación (liga tool_audit_log a la conversación,
// ver session.ts) — llamadas posteriores lo ignoran, ya existe la sesión.
export function getSession(ctx?: RouteContext): BrainSession {
  if (!session) session = createBrainSession(ctx);
  return session;
}
