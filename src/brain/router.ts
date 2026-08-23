// Router por capacidad (V4, ver plan) — DIRECT (sin LLM) / KNOWLEDGE (search_memory
// + LLM barato) / AGENT (Claude + tools). Heurística de keywords primero (gratis,
// sin latencia de red); si es ambigua, cae a clasificación por el LLM barato; si
// tampoco hay LLM barato configurado, por seguridad va a AGENT (nunca se pierde
// una respuesta por falta de plata — el peor caso es gastar cuota de Claude de más,
// no dejar al usuario sin respuesta).
import { searchMemory } from "./memory.ts";
import { chatComplete, cheapLlmAvailable } from "./cheapLLM.ts";

export type Category = "direct" | "knowledge" | "agent";

const GREETING_RE = /^(hola|holi|buenas|hey|buen[oa]s?\s*(d[ií]as?|tardes|noches))[\s!.,]*$/i;
const TIME_RE = /\bqu[eé]\s*(hora|d[ií]a|fecha)\s*(es|era|tenemos)?\b/i;
const CALC_RE = /^[\s\d+\-*/().]+$/;

const AGENT_RE =
  /\b(github|pull request|\bpr\b|repos?(itorios?)?|bash|comando|terminal|servidor|deploy|despleg|docker|browser|navegador|p[aá]gina web|internet|busca(r|me)?\s+en\s+(la\s+)?(web|internet)|screenshot|captura)\b/i;

const KNOWLEDGE_RE =
  /\b(record[aá]s|te acord[aá]s|qu[eé] sab[eé]s|qui[eé]n soy|mis?\s+proyectos?|mi\s+informaci[oó]n|seg[uú]n\s+(mi|tu)\s+memoria|qu[eé]\s+notas?\s+ten[eé]s)\b/i;

function classifyHeuristic(text: string): Category | null {
  const t = text.trim();
  if (GREETING_RE.test(t)) return "direct";
  if (TIME_RE.test(t)) return "direct";
  if (CALC_RE.test(t) && /\d/.test(t)) return "direct";
  if (AGENT_RE.test(t)) return "agent";
  if (KNOWLEDGE_RE.test(t)) return "knowledge";
  return null;
}

async function classifyWithCheapLlm(text: string): Promise<Category> {
  try {
    const raw = await chatComplete([
      {
        role: "system",
        content:
          "Clasificá el mensaje del usuario en UNA sola palabra: direct, knowledge o agent.\n" +
          "- direct: saludo, hora/fecha, cálculo simple.\n" +
          "- knowledge: pregunta sobre información personal/notas guardadas del usuario.\n" +
          "- agent: pide ejecutar algo (código, GitHub, servidor, navegar la web) o cualquier cosa compleja/ambigua.\n" +
          "Respondé solo la palabra, nada más.",
      },
      { role: "user", content: text },
    ]);
    const w = raw.toLowerCase().trim();
    if (w.startsWith("direct")) return "direct";
    if (w.startsWith("knowledge")) return "knowledge";
    return "agent";
  } catch {
    return "agent"; // el LLM barato falló -> AGENT como red de seguridad
  }
}

export async function classify(text: string): Promise<Category> {
  const heuristic = classifyHeuristic(text);
  if (heuristic) return heuristic;
  if (!cheapLlmAvailable()) return "agent";
  return classifyWithCheapLlm(text);
}

/** Maneja DIRECT sin ningún LLM. Devuelve null si en realidad no puede resolverlo (cae a AGENT). */
function handleDirect(text: string): string | null {
  const t = text.trim();
  if (GREETING_RE.test(t)) return "Hola! Contame qué necesitás.";
  if (TIME_RE.test(t)) {
    const now = new Date();
    return `Ahora son las ${now.toLocaleTimeString("es-ES")} del ${now.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (hora del servidor).`;
  }
  if (CALC_RE.test(t) && /\d/.test(t)) {
    try {
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${t});`)();
      if (typeof result === "number" && Number.isFinite(result)) return `= ${result}`;
    } catch {
      /* no era una expresión válida -> cae a AGENT */
    }
  }
  return null;
}

/** Maneja KNOWLEDGE: search_memory() + LLM barato sintetiza. Devuelve null si no hay LLM barato o falla. */
async function handleKnowledge(text: string): Promise<string | null> {
  if (!cheapLlmAvailable()) return null;
  const results = await searchMemory(text, 5);
  const context =
    results.length > 0
      ? results.map((r) => `- memory/${r.document_path}: ${r.snippet}`).join("\n")
      : "(sin resultados en la memoria)";
  try {
    return await chatComplete([
      {
        role: "system",
        content:
          "Sos Robin, el asistente personal del usuario. Respondé en español, corto y directo, " +
          "basándote SOLO en las notas de memoria de abajo. Si no alcanzan para responder, decilo " +
          "claramente en vez de inventar.\n\nNotas de memoria:\n" + context,
      },
      { role: "user", content: text },
    ]);
  } catch {
    return null;
  }
}

/**
 * Punto de entrada del router. `sendToAgent` es lo que ejecuta la rama AGENT
 * (Claude + tools) — el router no sabe nada de sesiones ni de canales, eso
 * sigue viviendo en cada adapter/BrainSession.
 */
export async function routeMessage(text: string, sendToAgent: () => Promise<string>): Promise<string> {
  const category = await classify(text);

  if (category === "direct") {
    const reply = handleDirect(text);
    if (reply !== null) return reply;
  }

  if (category === "knowledge") {
    const reply = await handleKnowledge(text);
    if (reply !== null) return reply;
  }

  return sendToAgent();
}
