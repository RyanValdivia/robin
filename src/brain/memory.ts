// Memory Engine (V1): search_memory()/remember() reales sobre el vault.
// Interfaz estable — quien llama a searchMemory()/remember() no sabe (ni le
// importa) que atrás hay grep + Postgres FTS/pgvector. Ver plan, sección Memoria.
import * as fs from "node:fs";
import * as path from "node:path";
import { MEMORY_DIR, MEMORY_INDEX } from "../config.ts";
import { pool } from "../db.ts";
import { embed } from "./embeddings.ts";

export type NoteMeta = {
  type: "user" | "project" | "infrastructure" | "reference";
  name: string;
  description: string;
};

function listNoteFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md") && full !== MEMORY_INDEX) {
        out.push(path.relative(MEMORY_DIR, full).replace(/\\/g, "/"));
      }
    }
  }
  if (fs.existsSync(MEMORY_DIR)) walk(MEMORY_DIR);
  return out;
}

// El vault es editable a mano (Obsidian, notas sincronizadas manualmente
// entre Windows/Linux, etc.) — normalizamos CRLF acá, en el único punto por
// donde pasa toda lectura de una nota, así el resto del código (regex de
// frontmatter, split por líneas) puede asumir siempre LF.
function readNoteFile(relativePath: string): string {
  return fs.readFileSync(path.join(MEMORY_DIR, relativePath), "utf-8").replace(/\r\n/g, "\n");
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

/** Búsqueda exacta: substring case-insensitive sobre el contenido de cada nota. */
function grepSearch(query: string, limit = 5): Array<{ document_path: string; snippet: string }> {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  if (terms.length === 0) return [];
  const results: Array<{ document_path: string; snippet: string }> = [];
  for (const rel of listNoteFiles()) {
    const content = readNoteFile(rel);
    const lower = content.toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      const line = content.split("\n").find((l) => terms.some((t) => l.toLowerCase().includes(t)));
      results.push({ document_path: rel, snippet: (line ?? content.slice(0, 120)).trim() });
      if (results.length >= limit) break;
    }
  }
  return results;
}

/** Búsqueda semántica: pgvector, similitud de coseno sobre memory_embeddings. */
async function vectorSearch(
  query: string,
  limit = 5,
): Promise<Array<{ document_path: string; snippet: string; score: number }>> {
  const vec = await embed(query);
  const literal = `[${vec.join(",")}]`;
  const { rows } = await pool.query(
    `SELECT document_path, left(chunk, 200) AS snippet, 1 - (embedding <=> $1::vector) AS score
     FROM memory_embeddings
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [literal, limit],
  );
  return rows;
}

export type SearchResult = { document_path: string; snippet: string; source: "exact" | "semantic"; score?: number };

/** search_memory() — la interfaz estable. V1: exact (grep) + semantic (pgvector), sin reranking todavía (V4). */
export async function searchMemory(query: string, k = 5): Promise<SearchResult[]> {
  const [exact, semantic] = await Promise.all([
    Promise.resolve(grepSearch(query, k)),
    vectorSearch(query, k).catch(() => []), // si Postgres no está disponible, degrada a solo grep
  ]);
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const r of exact) {
    if (seen.has(r.document_path)) continue;
    seen.add(r.document_path);
    merged.push({ ...r, source: "exact" });
  }
  for (const r of semantic) {
    if (seen.has(r.document_path)) continue;
    seen.add(r.document_path);
    merged.push({ ...r, source: "semantic" });
  }
  return merged.slice(0, k);
}

/** Reindexa una nota existente: recalcula embedding y upsertea en memory_embeddings. */
export async function indexNote(relativePath: string): Promise<void> {
  const content = stripFrontmatter(readNoteFile(relativePath));
  const vec = await embed(content || relativePath);
  const literal = `[${vec.join(",")}]`;
  await pool.query(
    `INSERT INTO memory_embeddings (document_path, chunk, embedding, updated_at)
     VALUES ($1, $2, $3::vector, now())
     ON CONFLICT (document_path) DO UPDATE
       SET chunk = excluded.chunk, embedding = excluded.embedding, updated_at = now()`,
    [relativePath, content, literal],
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  user: "User",
  projects: "Projects",
  infrastructure: "Infrastructure",
  reference: "Reference",
};

function updateMemoryIndex(relativePath: string, description: string): void {
  const category = relativePath.split("/")[0];
  const label = CATEGORY_LABELS[category] ?? category;
  let text = fs.existsSync(MEMORY_INDEX)
    ? fs.readFileSync(MEMORY_INDEX, "utf-8").replace(/\r\n/g, "\n")
    : "# Memory Index\n";
  const bullet = `- ${relativePath} — ${description}`;
  const headerRe = new RegExp(`^## ${label}\\s*$`, "m");

  // saco cualquier bullet previo para este mismo path (updates)
  text = text
    .split("\n")
    .filter((l) => !l.startsWith(`- ${relativePath} `) && !l.startsWith(`- ${relativePath}—`))
    .join("\n");

  if (headerRe.test(text)) {
    text = text.replace(headerRe, (m) => `${m}\n${bullet}`);
  } else {
    text = text.trimEnd() + `\n\n## ${label}\n${bullet}\n`;
  }
  fs.writeFileSync(MEMORY_INDEX, text.trimEnd() + "\n");
}

/** remember() — crea/actualiza una nota + reindexa + actualiza MEMORY.md. Único camino de escritura al vault (reemplaza Write/Edit crudos para que el índice semántico nunca quede desincronizado). */
export async function remember(relativePath: string, meta: NoteMeta, body: string): Promise<void> {
  if (!relativePath.endsWith(".md")) relativePath += ".md";
  const full = path.join(MEMORY_DIR, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const frontmatter = `---\ntype: ${meta.type}\nname: ${meta.name}\ndescription: ${meta.description}\n---\n\n`;
  fs.writeFileSync(full, frontmatter + body.trim() + "\n");
  updateMemoryIndex(relativePath, meta.description);
  await indexNote(relativePath);
}

/** Reindexa todo el vault desde cero (bootstrap / recuperación). */
export async function reindexAll(): Promise<number> {
  const files = listNoteFiles();
  for (const f of files) await indexNote(f);
  return files.length;
}

function parseFrontmatter(content: string): { type: string; name: string; description: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  const meta: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { type: meta.type ?? "", name: meta.name ?? "", description: meta.description ?? "" };
}

export type NoteEntry = { path: string; type: string; name: string; description: string };

/** Lista todas las notas del vault con su metadata (frontmatter) — para la Web UI (V7). */
export function listNotes(): NoteEntry[] {
  return listNoteFiles().map((rel) => ({ path: rel, ...parseFrontmatter(readNoteFile(rel)) }));
}

/**
 * Lee el contenido (sin frontmatter) de una nota del vault, para la Web UI (V7).
 * null si el path no es una nota real del vault — previene path traversal, solo
 * se puede leer lo que `listNoteFiles()` ya enumeró.
 */
export function readNote(relativePath: string): string | null {
  if (!listNoteFiles().includes(relativePath)) return null;
  return stripFrontmatter(readNoteFile(relativePath));
}
