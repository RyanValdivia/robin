// Tools MCP propios de JARVIS: search_memory / remember.
// Único camino de escritura al vault — reemplaza Write/Edit crudos así el
// índice semántico (pgvector) nunca queda desincronizado de los archivos.
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { remember, searchMemory } from "./memory.ts";

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

export const memoryMcpServer = createSdkMcpServer({
  name: "jarvis-memory",
  version: "0.1.0",
  tools: [searchMemoryTool, rememberTool],
});
