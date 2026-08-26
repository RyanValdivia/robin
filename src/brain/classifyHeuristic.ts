// Heurística de clasificación DIRECT/KNOWLEDGE/AGENT — pura, sin red/DB
// (separada de router.ts para que sea testeable sin arrastrar los imports
// pesados de router.ts: scheduler.ts abre Redis, conversationLog.ts abre
// Postgres, ambos a nivel de módulo. Importar router.ts entero solo para
// probar regexes de texto colgaba los tests esperando conexiones que no
// existen en el entorno de test — ver memory/projects/robin.md, gap #6).
export type Category = "direct" | "knowledge" | "agent";

export const GREETING_RE = /^(hola|holi|buenas|hey|buen[oa]s?\s*(d[ií]as?|tardes|noches))[\s!.,]*$/i;
export const TIME_RE = /\bqu[eé]\s*(hora|d[ií]a|fecha)\s*(es|era|tenemos)?\b/i;
export const CALC_RE = /^[\s\d+\-*/().]+$/;

// "Recordame comprar leche a las 8" / "recordame en 20 minutos estirar". Solo el
// patrón simple y sin ambigüedad — cualquier otra forma cae a AGENT (Claude calcula
// la fecha/hora con la tool schedule_task, ver brain/tools.ts).
const REMINDER_VERB = /recordame|recu[eé]rdame|agendame/i;
export const REMINDER_AT_RE =
  /^(?:recordame|recu[eé]rdame|agendame)\s+(.+?)\s+(mañana\s+)?a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\.?$/i;
export const REMINDER_IN_RE =
  /^(?:recordame|recu[eé]rdame|agendame)\s+(.+?)\s+en\s+(\d+)\s*(minutos?|min|horas?|hs?)\.?$/i;

const AGENT_RE =
  /\b(github|pull request|\bpr\b|repos?(itorios?)?|bash|comando|terminal|servidor|deploy|despleg|docker|browser|navegador|p[aá]gina web|internet|busca(r|me)?\s+en\s+(la\s+)?(web|internet)|screenshot|captura)\b/i;

const KNOWLEDGE_RE =
  /\b(record[aá]s|te acord[aá]s|qu[eé] sab[eé]s|qui[eé]n soy|mis?\s+proyectos?|mi\s+informaci[oó]n|seg[uú]n\s+(mi|tu)\s+memoria|qu[eé]\s+notas?\s+ten[eé]s)\b/i;

// Preguntas sobre el propio asistente (identidad/capacidades) — NO son knowledge
// (eso es memoria del USUARIO, no del bot). Robin solo puede presentarse bien vía
// AGENT (Claude), que tiene la persona real en el system prompt; KNOWLEDGE buscaría
// en el vault, no encontraría nada, y respondería "no tengo información".
const IDENTITY_RE =
  /\b(qu[eé]\s+(eres|sos)|qui[eé]n\s+(eres|sos)|c[oó]mo\s+te\s+llam[aá]s|qu[eé]\s+(puedes|pod[eé]s)\s+hacer|qu[eé]\s+sabe[sé]\s+hacer|para\s+qu[eé]\s+sirv[eé]s)\b/i;

export function classifyHeuristic(text: string): Category | null {
  const t = text.trim();
  if (REMINDER_AT_RE.test(t) || REMINDER_IN_RE.test(t)) return "direct";
  if (REMINDER_VERB.test(t)) return "agent"; // recordatorio con fecha/hora no trivial -> Claude la calcula
  if (GREETING_RE.test(t)) return "direct";
  if (TIME_RE.test(t)) return "direct";
  if (CALC_RE.test(t) && /\d/.test(t)) return "direct";
  if (IDENTITY_RE.test(t)) return "agent";
  if (AGENT_RE.test(t)) return "agent";
  if (KNOWLEDGE_RE.test(t)) return "knowledge";
  return null;
}
