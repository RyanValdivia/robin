// Router por capacidad (V4, ver plan) — DIRECT (sin LLM) / KNOWLEDGE (search_memory
// + LLM barato) / AGENT (Claude + tools). Heurística de keywords primero (gratis,
// sin latencia de red); si es ambigua, cae a clasificación por el LLM barato; si
// tampoco hay LLM barato configurado, por seguridad va a AGENT (nunca se pierde
// una respuesta por falta de plata — el peor caso es gastar cuota de Claude de más,
// no dejar al usuario sin respuesta).
import { searchMemory } from "./memory.ts";
import { chatComplete, cheapLlmAvailable } from "./cheapLLM.ts";
import { scheduleReminder } from "./scheduler.ts";

export type Category = "direct" | "knowledge" | "agent";

// Zona horaria fija del usuario (Lima, UTC-5 sin DST) — todo lo que muestra/calcula
// hora local acá usa esto, no la del servidor (VPS corre en UTC).
const TZ = "America/Lima";
const TZ_OFFSET_HOURS = 5; // UTC-5, Perú no tiene horario de verano

function limaNowParts(): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}

/** Contexto del canal que llama — lo necesita el recordatorio DIRECT (V5) para saber a quién avisar. */
export type RouteContext = { userId: number; channel: string; externalId: string };

const GREETING_RE = /^(hola|holi|buenas|hey|buen[oa]s?\s*(d[ií]as?|tardes|noches))[\s!.,]*$/i;
const TIME_RE = /\bqu[eé]\s*(hora|d[ií]a|fecha)\s*(es|era|tenemos)?\b/i;
const CALC_RE = /^[\s\d+\-*/().]+$/;

// "Recordame comprar leche a las 8" / "recordame en 20 minutos estirar". Solo el
// patrón simple y sin ambigüedad — cualquier otra forma cae a AGENT (Claude calcula
// la fecha/hora con la tool schedule_task, ver brain/tools.ts).
const REMINDER_VERB = /recordame|recu[eé]rdame|agendame/i;
const REMINDER_AT_RE =
  /^(?:recordame|recu[eé]rdame|agendame)\s+(.+?)\s+(mañana\s+)?a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\.?$/i;
const REMINDER_IN_RE =
  /^(?:recordame|recu[eé]rdame|agendame)\s+(.+?)\s+en\s+(\d+)\s*(minutos?|min|horas?|hs?)\.?$/i;

const AGENT_RE =
  /\b(github|pull request|\bpr\b|repos?(itorios?)?|bash|comando|terminal|servidor|deploy|despleg|docker|browser|navegador|p[aá]gina web|internet|busca(r|me)?\s+en\s+(la\s+)?(web|internet)|screenshot|captura)\b/i;

const KNOWLEDGE_RE =
  /\b(record[aá]s|te acord[aá]s|qu[eé] sab[eé]s|qui[eé]n soy|mis?\s+proyectos?|mi\s+informaci[oó]n|seg[uú]n\s+(mi|tu)\s+memoria|qu[eé]\s+notas?\s+ten[eé]s)\b/i;

function classifyHeuristic(text: string): Category | null {
  const t = text.trim();
  if (REMINDER_AT_RE.test(t) || REMINDER_IN_RE.test(t)) return "direct";
  if (REMINDER_VERB.test(t)) return "agent"; // recordatorio con fecha/hora no trivial -> Claude la calcula
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

function nextOccurrence(hour: number, minute: number, forceTomorrow: boolean): Date {
  const p = limaNowParts();
  // hour:minute son hora Lima -> UTC = hora Lima + 5.
  let target = Date.UTC(p.year, p.month - 1, p.day, hour + TZ_OFFSET_HOURS, minute, 0, 0);
  if (forceTomorrow || target <= Date.now()) target += 24 * 3_600_000;
  return new Date(target);
}

/** Intenta armar un recordatorio DIRECT (sin LLM). null si no aplica o falta contexto de canal. */
async function tryScheduleDirectReminder(text: string, ctx?: RouteContext): Promise<string | null> {
  if (!ctx) return null;
  const t = text.trim();

  const at = REMINDER_AT_RE.exec(t);
  if (at) {
    const [, body, tomorrow, hourStr, minStr, ampm] = at;
    let hour = parseInt(hourStr, 10);
    const minute = minStr ? parseInt(minStr, 10) : 0;
    if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (ampm?.toLowerCase() === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    const when = nextOccurrence(hour, minute, Boolean(tomorrow));
    await scheduleReminder(ctx.userId, ctx.channel, ctx.externalId, body.trim(), when);
    return `Listo, te aviso "${body.trim()}" el ${when.toLocaleString("es-PE", { timeZone: TZ })}.`;
  }

  const inMatch = REMINDER_IN_RE.exec(t);
  if (inMatch) {
    const [, body, amountStr, unit] = inMatch;
    const amount = parseInt(amountStr, 10);
    const ms = /hora|hs/i.test(unit) ? amount * 3_600_000 : amount * 60_000;
    const when = new Date(Date.now() + ms);
    await scheduleReminder(ctx.userId, ctx.channel, ctx.externalId, body.trim(), when);
    return `Listo, te aviso "${body.trim()}" el ${when.toLocaleString("es-ES")}.`;
  }

  return null;
}

/** Maneja DIRECT sin LLM (salvo recordatorios, que solo necesitan Postgres/Redis). null si no puede resolverlo (cae a AGENT). */
async function handleDirect(text: string, ctx?: RouteContext): Promise<string | null> {
  const t = text.trim();
  const reminder = await tryScheduleDirectReminder(t, ctx);
  if (reminder) return reminder;
  if (GREETING_RE.test(t)) return "Hola! Contame qué necesitás.";
  if (TIME_RE.test(t)) {
    const now = new Date();
    return `Ahora son las ${now.toLocaleTimeString("es-PE", { timeZone: TZ })} del ${now.toLocaleDateString("es-PE", { timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric" })} (hora de Lima).`;
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
 * (Claude + tools) — el router no sabe nada de sesiones, eso sigue viviendo en
 * cada adapter/BrainSession. `ctx` (opcional) es el canal que llama — sin él,
 * los recordatorios DIRECT no tienen a quién avisar y caen a AGENT.
 */
export async function routeMessage(
  text: string,
  sendToAgent: () => Promise<string>,
  ctx?: RouteContext,
): Promise<string> {
  const category = await classify(text);

  if (category === "direct") {
    const reply = await handleDirect(text, ctx);
    if (reply !== null) return reply;
  }

  if (category === "knowledge") {
    const reply = await handleKnowledge(text);
    if (reply !== null) return reply;
  }

  return sendToAgent();
}
