import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

const ROOT = process.cwd();
const MEMORY_DIR = path.join(ROOT, "memory");
const MEMORY_INDEX = path.join(MEMORY_DIR, "MEMORY.md");

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

## Memoria (vault en memory/)
- \`memory/MEMORY.md\` es el índice — mapa de qué notas existen, no su contenido completo.
- Cuando necesites el detalle de una nota, usá Read/Grep/Glob sobre \`memory/\` (esto es
  tu \`search_memory\` por ahora, versión V1: búsqueda exacta/grep).
- Cuando el usuario te pida recordar algo, escribí o actualizá una nota en
  \`memory/<categoria>/<archivo>.md\` (categorías: user, projects, infrastructure,
  reference) con frontmatter \`type\`/\`name\`/\`description\`, y actualizá
  \`memory/MEMORY.md\` para listarla. Sé conciso, una nota por hecho/tema.
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

  console.log("JARVIS V0 — CLI local. Escribí 'salir' para terminar.\n");
  rl.prompt();

  const q = query({
    prompt: inputGenerator(rl),
    options: {
      settingSources: [], // aislado: no hereda hooks/MCP/settings del usuario
      strictMcpConfig: true,
      mcpServers: {},
      systemPrompt: buildSystemPrompt(),
      tools: ["Read", "Write", "Edit", "Grep", "Glob"],
      // V0: sin Bash/red, solo file tools sobre el vault — bypass es razonable acá.
      // Se reintroduce control fino (PreToolUse hooks) cuando entre Bash en V2.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      cwd: ROOT,
    },
  });

  for await (const msg of q as AsyncGenerator<any>) {
    if (msg.type === "assistant") {
      const text = (msg.message?.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (text) console.log(`\nJARVIS> ${text}\n`);
      if (!rl.closed) rl.prompt();
    } else if (msg.type === "result" && msg.is_error) {
      console.error(`\n[error] ${msg.subtype ?? "unknown"}\n`);
      if (!rl.closed) rl.prompt();
    }
  }

  console.log("\nChau.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
