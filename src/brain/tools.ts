// Tools MCP propios de Robin: search_memory / remember / schedule_task / agenda.
// Único camino de escritura al vault — reemplaza Write/Edit crudos así el
// índice semántico (pgvector) nunca queda desincronizado de los archivos.
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { remember, searchMemory, forget } from "./memory.ts";
import { getOwnerUserId, resolveOwnerChannel } from "./auth.ts";
import {
  scheduleReminder,
  scheduleRecurringReminder,
  cancelReminder,
  listPendingReminders,
  ALL_CHANNELS,
} from "./scheduler.ts";
import { addAgendaBlock, listAgendaBlocks, removeAgendaBlock } from "./agenda.ts";

const searchMemoryTool = tool(
  "search_memory",
  "Busca en la memoria de largo plazo (vault de notas) por texto exacto y por " +
    "significado, rankeadas por relevancia. Devuelve rutas relativas a memory/ con un " +
    "fragmento — si necesitás el contenido completo de una nota, leela después con Read. " +
    "Si los primeros 5 no alcanzan, repetí la consulta con offset=5 para los siguientes.",
  {
    query: z.string().describe("Qué buscar, en lenguaje natural"),
    offset: z.number().int().min(0).optional().describe("Cuántos resultados saltar (paginación) — 0 por defecto"),
  },
  async ({ query, offset }) => {
    const results = await searchMemory(query, 5, offset ?? 0);
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

const forgetTool = tool(
  "forget",
  "Borra una nota de la memoria de largo plazo — la saca del vault, del índice semántico " +
    "y de MEMORY.md. Usala cuando el usuario pida explícitamente olvidar/borrar algo que " +
    "guardaste antes; no la uses para 'actualizar' una nota (para eso, remember() con el " +
    "mismo relative_path pisa el contenido).",
  { relative_path: z.string().describe("Ruta relativa dentro de memory/ de la nota a borrar") },
  async ({ relative_path }) => {
    const ok = await forget(relative_path);
    return {
      content: [
        { type: "text", text: ok ? `Borrado memory/${relative_path}.` : `No encontré memory/${relative_path}.` },
      ],
    };
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
    // Si run_at ya pasó, casi seguro Claude calculó a partir de una hora
    // vieja (ver session.ts, bug de la hora congelada en system prompt) —
    // mejor rechazar y que recalcule con la hora fresca del último
    // <system-reminder> que ya, disparar de una silenciosamente.
    const msUntil = runAt.getTime() - Date.now();
    if (msUntil <= 0) {
      return {
        content: [
          {
            type: "text",
            text: `run_at_iso (${run_at_iso}) ya pasó — recalculá usando la fecha/hora del ÚLTIMO "Fecha/hora actual" que te mandé (no la de "al arrancar esta sesión" del prompt de sistema).`,
          },
        ],
      };
    }
    const id = await scheduleReminder(owner.userId, ALL_CHANNELS, text, runAt);
    const minutes = Math.round(msUntil / 60_000);
    return {
      content: [{ type: "text", text: `Programado (id ${id}) para ${runAt.toISOString()} (en ${minutes} min).` }],
    };
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
    const id = await scheduleRecurringReminder(owner.userId, ALL_CHANNELS, text, cron_expr);
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

const DOW_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const addAgendaBlockTool = tool(
  "add_agenda_block",
  "Agrega un bloque de horario OCUPADO a la agenda del dueño (clases, trabajo, lo que sea) — " +
    "a diferencia de schedule_task/schedule_recurring_reminder, esto NUNCA manda un aviso, es " +
    "solo para que quede registrado que a esa hora está ocupado (se ve en la tab Horario de la " +
    "Web). Dale EXACTAMENTE uno de day_of_week (se repite todas las semanas ese día, ej. clases " +
    "fijas) o date (una fecha puntual, no se repite, ej. un examen puntual). IMPORTANTE: label " +
    "es la identidad del curso/evento — usá EXACTAMENTE el mismo texto (no importa mayúsculas) " +
    "cada vez que sea 'lo mismo', así una clase recurrente y, más adelante, un examen puntual de " +
    "ESE curso quedan relacionados y comparten color solos (get-or-create por nombre, ver " +
    "agenda.ts) — no hace falta ningún paso extra para vincularlos, alcanza con repetir el label.",
  {
    label: z.string().describe("Qué es el bloque/curso, ej. 'Cálculo' — MISMO texto siempre que sea el mismo curso"),
    start_time: z.string().describe("Hora de inicio HH:MM 24h, ej. '08:00'"),
    end_time: z.string().describe("Hora de fin HH:MM 24h, ej. '10:00'"),
    day_of_week: z.number().int().min(0).max(6).optional().describe("0=domingo..6=sábado — recurrente semanal"),
    date: z.string().optional().describe("Fecha exacta ISO 'YYYY-MM-DD' — puntual, no se repite"),
    teacher: z.string().optional().describe("Docente/responsable, si lo menciona (opcional)"),
    description: z.string().optional().describe("Notas libres, ej. aula/link/lo que sea (opcional)"),
  },
  async ({ label, start_time, end_time, day_of_week, date, teacher, description }) => {
    const userId = await getOwnerUserId();
    if (!userId) return { content: [{ type: "text", text: "No hay dueño configurado." }] };
    if ((day_of_week === undefined) === (date === undefined)) {
      return { content: [{ type: "text", text: "Dame EXACTAMENTE uno de day_of_week o date, no los dos ni ninguno." }] };
    }
    try {
      const id = await addAgendaBlock(
        userId,
        label,
        start_time,
        end_time,
        day_of_week !== undefined ? { dayOfWeek: day_of_week } : { date: date! },
        { teacher, description },
      );
      return { content: [{ type: "text", text: `Agregado (id ${id}).` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `No pude agregarlo: ${(err as Error).message}` }] };
    }
  },
);

const listAgendaTool = tool(
  "list_agenda",
  "Lista todos los bloques de horario ocupado del dueño (agenda, no recordatorios).",
  {},
  async () => {
    const userId = await getOwnerUserId();
    if (!userId) return { content: [{ type: "text", text: "No hay dueño configurado." }] };
    const rows = await listAgendaBlocks(userId);
    if (rows.length === 0) return { content: [{ type: "text", text: "La agenda está vacía." }] };
    const text = rows
      .map((b) => {
        const when = b.day_of_week !== null ? `cada ${DOW_NAMES[b.day_of_week]}` : b.date!;
        const extra = [b.teacher, b.description].filter(Boolean).join(" · ");
        return `[${b.id}] ${when} ${b.start_time.slice(0, 5)}-${b.end_time.slice(0, 5)} — ${b.label}${extra ? ` (${extra})` : ""}`;
      })
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

const removeAgendaBlockTool = tool(
  "remove_agenda_block",
  "Borra un bloque de la agenda por su id (ver list_agenda).",
  { id: z.number().describe("id del bloque, de list_agenda") },
  async ({ id }) => {
    const userId = await getOwnerUserId();
    if (!userId) return { content: [{ type: "text", text: "No hay dueño configurado." }] };
    const ok = await removeAgendaBlock(userId, id);
    return { content: [{ type: "text", text: ok ? `Borrado el bloque ${id}.` : `No encontré un bloque con id ${id}.` }] };
  },
);

export const memoryMcpServer = createSdkMcpServer({
  name: "robin-memory",
  version: "0.1.0",
  tools: [
    searchMemoryTool,
    rememberTool,
    forgetTool,
    scheduleTaskTool,
    scheduleRecurringReminderTool,
    listRemindersTool,
    cancelReminderTool,
    addAgendaBlockTool,
    listAgendaTool,
    removeAgendaBlockTool,
  ],
});
