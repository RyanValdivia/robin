// Tools MCP propios de Robin: search_memory / remember / schedule_task.
// Único camino de escritura al vault — reemplaza Write/Edit crudos así el
// índice semántico (pgvector) nunca queda desincronizado de los archivos.
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { remember, searchMemory } from "./memory.ts";
import { getOwnerUserId, resolveOwnerChannel } from "./auth.ts";
import { scheduleReminder, scheduleRecurringReminder, cancelReminder, listPendingReminders } from "./scheduler.ts";

const searchMemoryTool = tool(
  "search_memory",
  "Busca en la memoria de largo plazo (vault de notas) por texto exacto y por " +
    "significado. Devuelve rutas relativas a memory/ con un fragmento — si necesitás " +
    "el contenido completo de una nota, leela después con Read.",
  { query: z.string().describe("Qué buscar, en lenguaje natural") },
  async ({ query }) => {
    const results = await searchMemory(query, 5);
    if (results.length === 0) {
      return { content: [{ type: "text", text: "Sin resultados en la memoria." }] };
    }
    const text = results
      .map((r) => `[${r.source}] memory/${r.document_path}${r.score ? ` (score ${r.score.toFixed(2)})` : ""}\n  ${r.snippet}`)
      .join("\n\n");
    return { content: [{ type: "text", text }] };
  },
);

const rememberTool = tool(
  "remember",
  "Crea o actualiza una nota en la memoria de largo plazo. Usá esto (no Write/Edit " +
    "directo) para que la nota quede indexada para búsqueda semántica y listada en " +
    "MEMORY.md automáticamente.",
  {
    relative_path: z
      .string()
      .describe("Ruta relativa dentro de memory/, ej. 'user/preferencias.md' o 'infrastructure/vps.md'"),
    type: z.enum(["user", "project", "infrastructure", "reference"]),
    name: z.string().describe("Nombre corto de la nota"),
    description: z.string().describe("Una línea — qué trata, se muestra en el índice MEMORY.md"),
    content: z.string().describe("Contenido de la nota, markdown, sin frontmatter"),
  },
  async ({ relative_path, type, name, description, content }) => {
    await remember(relative_path, { type, name, description }, content);
    return { content: [{ type: "text", text: `Guardado en memory/${relative_path}` }] };
  },
);

const scheduleTaskTool = tool(
  "schedule_task",
  "Programa un recordatorio para más adelante — el usuario lo recibe por su canal " +
    "(hoy: Telegram) cuando llega la hora, SIN que vos tengas que estar corriendo en ese " +
    "momento. Usalo cuando el usuario pida algo tipo 'recordame X' con una fecha/hora que " +
    "vos tengas que calcular (relativa, ambigua, etc. — si es simple tipo 'a las 8' el " +
    "router ya lo resuelve solo y esta tool ni se llama).",
  {
    text: z.string().describe("El texto del recordatorio, tal cual se le va a mandar al usuario"),
    run_at_iso: z.string().describe("Fecha/hora en ISO 8601 (con offset o UTC) en la que disparar"),
  },
  async ({ text, run_at_iso }) => {
    const owner = await resolveOwnerChannel();
    if (!owner) {
      return { content: [{ type: "text", text: "No encontré un canal registrado del dueño para notificar." }] };
    }
    const runAt = new Date(run_at_iso);
    if (Number.isNaN(runAt.getTime())) {
      return { content: [{ type: "text", text: `Fecha inválida: ${run_at_iso}` }] };
    }
    const id = await scheduleReminder(owner.userId, owner.channel, owner.externalId, text, runAt);
    return { content: [{ type: "text", text: `Programado (id ${id}) para ${runAt.toISOString()}.` }] };
  },
);

const scheduleRecurringReminderTool = tool(
  "schedule_recurring_reminder",
  "Programa un recordatorio que se repite solo (semanal, diario, etc.) hasta que el " +
    "usuario lo cancele — usalo para pedidos tipo 'recordame X todos los viernes a las 2pm' " +
    "o 'todos los días a las 8'. Vos calculás el patrón cron (5 campos: minuto hora " +
    "día-del-mes mes día-de-semana; día-de-semana 0=domingo..6=sábado, '*' = cualquiera). " +
    "Ejemplos: 'cada viernes a las 14:00' -> '0 14 * * 5'; 'todos los días a las 8am' -> " +
    "'0 8 * * *'; 'el 1 de cada mes a las 9' -> '0 9 1 * *'. Si piden 'avisame 1 hora antes " +
    "de X' y X ya tiene hora conocida, restá vos esa hora antes de armar el cron — esta tool " +
    "no sabe de 'antes de', solo ejecuta el horario que le des.",
  {
    text: z.string().describe("El texto del recordatorio, tal cual se le va a mandar al usuario cada vez"),
    cron_expr: z.string().describe("Patrón cron de 5 campos, hora LOCAL del usuario (America/Lima), ej. '0 14 * * 5'"),
  },
  async ({ text, cron_expr }) => {
    const owner = await resolveOwnerChannel();
    if (!owner) {
      return { content: [{ type: "text", text: "No encontré un canal registrado del dueño para notificar." }] };
    }
    const id = await scheduleRecurringReminder(owner.userId, owner.channel, owner.externalId, text, cron_expr);
    return { content: [{ type: "text", text: `Programado recurrente (id ${id}, cron "${cron_expr}").` }] };
  },
);

const listRemindersTool = tool(
  "list_reminders",
  "Lista los recordatorios pendientes del dueño (puntuales y recurrentes, no disparados/cancelados).",
  {},
  async () => {
    const userId = await getOwnerUserId();
    if (!userId) return { content: [{ type: "text", text: "No hay dueño configurado." }] };
    const rows = await listPendingReminders(userId);
    if (rows.length === 0) return { content: [{ type: "text", text: "No hay recordatorios pendientes." }] };
    const text = rows
      .map((r) => `[${r.id}] ${r.cron_expr ? `🔁 "${r.cron_expr}" (próximo: ${r.run_at})` : r.run_at} — ${r.text}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

const cancelReminderTool = tool(
  "cancel_reminder",
  "Cancela un recordatorio pendiente por su id, puntual o recurrente (ver list_reminders) — " +
    "a uno recurrente lo apaga para siempre, no salta solo la próxima vez.",
  { id: z.number().describe("id del recordatorio, de list_reminders") },
  async ({ id }) => {
    const userId = await getOwnerUserId();
    if (!userId) return { content: [{ type: "text", text: "No hay dueño configurado." }] };
    const ok = await cancelReminder(userId, id);
    return { content: [{ type: "text", text: ok ? `Cancelado el recordatorio ${id}.` : `No encontré un recordatorio pendiente con id ${id}.` }] };
  },
);

export const memoryMcpServer = createSdkMcpServer({
  name: "robin-memory",
  version: "0.1.0",
  tools: [
    searchMemoryTool,
    rememberTool,
    scheduleTaskTool,
    scheduleRecurringReminderTool,
    listRemindersTool,
    cancelReminderTool,
  ],
});
