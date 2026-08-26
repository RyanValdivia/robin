// PreToolUse hook: guardarraíl sobre el Bash tool. Defensa en profundidad, no el
// único control (ver plan, sección Seguridad) — corre incluso bajo bypassPermissions.
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { pool } from "../db.ts";

const DENYLIST: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\b/i, reason: "borrado recursivo forzado (rm -rf)" },
  { pattern: /\bsudo\b/i, reason: "escalada de privilegios (sudo)" },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/i, reason: "pipe a shell de una descarga (curl|sh)" },
  { pattern: /\bmkfs\b|\bdd\s+if=/i, reason: "operación destructiva de disco" },
  { pattern: /:\(\)\{.*:\|:.*\};:/, reason: "fork bomb" },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: "escritura directa a un dispositivo de bloque" },
];

export const bashGuardHook: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return {};
  const command = String((input.tool_input as { command?: string })?.command ?? "");

  for (const { pattern, reason } of DENYLIST) {
    if (pattern.test(command)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Bloqueado por denylist de Robin: ${reason}. Comando: ${command}`,
        },
      };
    }
  }
  return {};
};

// PostToolUse hook: audit log (gap #2 del análisis de memoria, ver
// memory/projects/robin.md) — tool_audit_log estaba en el schema desde V1
// sin código que escribiera ahí. Fire-and-forget (mismo criterio que
// usage.ts): un fallo acá nunca rompe una respuesta real. Sin matcher ->
// corre para cualquier tool (Bash/Read/Grep/Glob/MCP).
//
// Factory en vez de hook fijo: al principio quedaba sin ligar a una
// conversación puntual (conversation_id siempre NULL) porque BrainSession no
// tenía noción de ctx al crearse. Ahora session.ts resuelve el
// conversation_id UNA vez por sesión (getOrCreateConversation) y lo pasa acá
// como promesa — el hook la espera en cada tool call (ya está resuelta para
// cualquier call que no sea la primerísima del turno inicial). Sin ctx (CLI,
// sesiones de un solo uso de proactive.ts) la promesa resuelve a null, mismo
// comportamiento que antes.
export function makeToolAuditHook(conversationIdPromise: Promise<number | null>): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const { tool_name, tool_input, tool_response } = input;
    const conversationId = await conversationIdPromise.catch(() => null);
    pool
      .query(`INSERT INTO tool_audit_log (conversation_id, tool_name, input, output) VALUES ($1, $2, $3, $4)`, [
        conversationId,
        tool_name,
        JSON.stringify(tool_input ?? null),
        JSON.stringify(tool_response ?? null),
      ])
      .catch((err) => console.error("[tool_audit] no pude loguear tool call:", err));
    return {};
  };
}

// Gap #7 del análisis de memoria: "sesión larga sin gestión de contexto
// visible". El Agent SDK YA compacta el contexto solo cuando se acerca al
// límite (autoCompactEnabled por defecto, ver PreCompact/PostCompact en el
// SDK) — Robin nunca lo logueaba, así que desde afuera parecía que no había
// estrategia. No se reemplaza el mecanismo (sería duplicar/pisar algo que ya
// funciona) — solo se lo hace visible en logs para poder confirmarlo en vivo.
export const compactionLogHook: HookCallback = async (input) => {
  if (input.hook_event_name === "PreCompact") {
    console.log("[compact] arrancando compactación de contexto (sesión acercándose al límite)");
  } else if (input.hook_event_name === "PostCompact") {
    console.log(`[compact] listo. Resumen: ${input.compact_summary.slice(0, 200)}...`);
  }
  return {};
};
