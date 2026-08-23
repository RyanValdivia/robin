// PreToolUse hook: guardarraíl sobre el Bash tool. Defensa en profundidad, no el
// único control (ver plan, sección Seguridad) — corre incluso bajo bypassPermissions.
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

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
          permissionDecisionReason: `Bloqueado por denylist de JARVIS: ${reason}. Comando: ${command}`,
        },
      };
    }
  }
  return {};
};
