import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs";
import * as readline from "node:readline";
import { ROOT, MEMORY_INDEX, MEMORY_DIR } from "./config.ts";
import { memoryMcpServer } from "./brain/tools.ts";

function loadMemoryIndex(): string {
  if (!fs.existsSync(MEMORY_INDEX)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(
      MEMORY_INDEX,
      "# Memory Index\n\n## User\n\n## Projects\n\n## Infrastructure\n\n## Reference\n",
    );
  }
  return fs.readFileSync(MEMORY_INDEX, "utf-8");
}

function buildSystemPrompt(): string {
  return `Sos JARVIS, el asistente personal del usuario. Respondé en español, breve y directo.

## Memoria
- \`memory/MEMORY.md\` (abajo) es el índice — mapa de qué notas existen, no su contenido.
- Para buscar algo que no está en el índice, usá la tool \`search_memory\` (combina
  búsqueda exacta y semántica). Para leer una nota completa una vez que sabés su ruta,
  usá Read.
- Para guardar o actualizar algo, usá la tool \`remember\` — no escribas archivos en
  \`memory/\` directo, así queda indexado para búsqueda semántica.
- No inventes datos sobre el usuario. Si no sabés algo, preguntá.

## Índice actual (MEMORY.md)
${loadMemoryIndex()}`;
}

async function* inputGenerator(rl: readline.Interface) {
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "salir" || trimmed.toLowerCase() === "exit") {
      rl.close();
      return;
    }
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: trimmed },
      parent_tool_use_id: null,
    };
  }
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "vos> ",
  });

  console.log("JARVIS V1 — CLI local + memory engine (Postgres/pgvector). Escribí 'salir' para terminar.\n");
  rl.prompt();

  const q = query({
    prompt: inputGenerator(rl),
    options: {
      settingSources: [], // aislado: no hereda hooks/MCP/settings del usuario
      strictMcpConfig: true,
      mcpServers: { "jarvis-memory": memoryMcpServer },
      systemPrompt: buildSystemPrompt(),
      // Read/Grep/Glob para que el agente pueda mirar el vault libremente;
      // search_memory/remember (MCP) son el camino estructurado.
      tools: ["Read", "Grep", "Glob"],
      allowedTools: ["mcp__jarvis-memory__search_memory", "mcp__jarvis-memory__remember"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      cwd: ROOT,
    },
  });

  for await (const msg of q as AsyncGenerator<any>) {
    if (msg.type === "assistant") {
      // Un turno puede traer varios mensajes assistant intermedios (ej. uno
      // solo con tool_use para llamar a search_memory, sin texto todavía).
      // Solo imprimimos si hay texto; el prompt se reimprime recién en "result",
      // que marca el turno realmente terminado.
      const text = (msg.message?.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (text) console.log(`\nJARVIS> ${text}\n`);
    } else if (msg.type === "result") {
      if (msg.is_error) console.error(`\n[error] ${msg.subtype ?? "unknown"}\n`);
      if (!rl.closed) rl.prompt();
    }
  }

  console.log("\nChau.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
