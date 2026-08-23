// Sesión de brain reutilizable — misma config (memoria, tools, hooks) para
// cualquier canal (CLI, Telegram, ...). Una sesión = un contexto de conversación
// persistente (Agent SDK streaming-input), no un query() nuevo por mensaje.
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { ROOT } from "../config.ts";
import { memoryMcpServer } from "./tools.ts";
import { buildMcpServers } from "./mcp.ts";
import { bashGuardHook } from "./hooks.ts";
import { buildSystemPrompt } from "./systemPrompt.ts";

function brainOptions(): Options {
  return {
    settingSources: [], // aislado: no hereda hooks/MCP/settings del usuario
    strictMcpConfig: true,
    mcpServers: { "jarvis-memory": memoryMcpServer, ...buildMcpServers() },
    systemPrompt: buildSystemPrompt(),
    tools: ["Read", "Grep", "Glob", "Bash"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [bashGuardHook] }] },
    cwd: ROOT,
  };
}

function extractText(msg: any): string {
  return (msg.message?.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
}

export type BrainSession = {
  /** Manda un mensaje y espera la respuesta completa del turno (incluye tool calls intermedios). */
  send: (text: string) => Promise<string>;
};

export function createBrainSession(): BrainSession {
  const queue: any[] = [];
  // Objetos wrapper (no `let` sueltos) para esquivar el narrowing de TS a
  // través de closures — con un `let` bare, TS termina infiriendo `never` acá.
  const waker: { fn: (() => void) | null } = { fn: null };
  const pending: { resolve: ((text: string) => void) | null } = { resolve: null };
  let buffer = "";

  async function* promptGenerator() {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift();
      } else {
        await new Promise<void>((resolve) => {
          waker.fn = resolve;
        });
      }
    }
  }

  const q = query({ prompt: promptGenerator(), options: brainOptions() });

  (async () => {
    for await (const msg of q as AsyncGenerator<any>) {
      if (msg.type === "assistant") {
        buffer += extractText(msg);
      } else if (msg.type === "result") {
        const text = msg.is_error ? `[error interno: ${msg.subtype ?? "desconocido"}]` : buffer;
        buffer = "";
        if (pending.resolve) {
          const resolve = pending.resolve;
          pending.resolve = null;
          resolve(text);
        }
      }
    }
  })();

  function send(text: string): Promise<string> {
    return new Promise((resolve) => {
      pending.resolve = resolve;
      queue.push({
        type: "user" as const,
        message: { role: "user" as const, content: text },
        parent_tool_use_id: null,
      });
      if (waker.fn) {
        const w = waker.fn;
        waker.fn = null;
        w();
      }
    });
  }

  return { send };
}
