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

/** Extrae los nombres de [[wikilinks]] del cuerpo de una nota (sin duplicados). */
function parseWikilinks(body: string): string[] {
  const names = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]|#]+)/g)) names.add(m[1].trim());
  return [...names];
}

/** name (frontmatter) -> document_path, para resolver [[wikilinks]] a rutas reales. */
function nameToPathMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const note of listNotes()) if (note.name) map.set(note.name, note.path);
  return map;
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

export type SearchResult = {
  document_path: string;
  snippet: string;
  source: "exact" | "semantic" | "linked";
  score?: number;
};

// Score sintético para un hit exacto: 1 (máxima confianza — matcheó texto
// literal) más un pequeño bonus por cantidad de términos matcheados, para que
// entre dos exactos desempate el que cubre más de la query. Nunca supera a
// otro exacto por mucho ni se confunde con el 0..1 de similitud coseno.
function exactScore(snippet: string, terms: string[]): number {
  const lower = snippet.toLowerCase();
  const hits = terms.filter((t) => lower.includes(t)).length;
  return 1 + hits * 0.01;
}

/**
 * search_memory() — la interfaz estable. V1: exact (grep) + semantic (pgvector),
 * V1.1: + vecinos por [[wikilink]], V1.2: + reranking por score combinado (antes
 * mezclaba por orden de aparición, ver gap #5 del análisis de memoria).
 * `offset` para paginar sin repetir resultados ya vistos.
 */
export async function searchMemory(query: string, k = 5, offset = 0): Promise<SearchResult[]> {
  const fetchN = offset + k; // pedimos lo suficiente para poder recortar el offset después
  const [exact, semantic] = await Promise.all([
    Promise.resolve(grepSearch(query, fetchN)),
    vectorSearch(query, fetchN).catch(() => []), // si Postgres no está disponible, degrada a solo grep
  ]);

  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const byPath = new Map<string, SearchResult>();
  for (const r of exact) {
    byPath.set(r.document_path, { ...r, source: "exact", score: exactScore(r.snippet, terms) });
  }
  for (const r of semantic) {
    if (byPath.has(r.document_path)) continue; // un exacto ya vale más que semántico sobre la misma nota
    byPath.set(r.document_path, { ...r, source: "semantic" });
  }

  // Reranking real: score combinado descendente (antes: orden de aparición exact->semantic).
  const ranked = [...byPath.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const seen = new Set(ranked.map((r) => r.document_path));

  // Expansión por grafo: 1 hop de [[wikilinks]] salientes de los hits directos,
  // al final (sin score de relevancia de texto — la relación explícita ya es la señal).
  const linked: SearchResult[] = [];
  if (ranked.length > 0 && ranked.length < fetchN) {
    for (const hit of ranked) {
      if (ranked.length + linked.length >= fetchN) break;
      const neighbors = await linkedNotes(hit.document_path).catch(() => []);
      for (const path of neighbors) {
        if (ranked.length + linked.length >= fetchN) break;
        if (seen.has(path)) continue;
        seen.add(path);
        linked.push({ document_path: path, snippet: stripFrontmatter(readNoteFile(path)).slice(0, 200), source: "linked" });
      }
    }
  }

  return [...ranked, ...linked].slice(offset, offset + k);
}

/** Reindexa una nota existente: recalcula embedding + [[wikilinks]] salientes. */
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

  const links = parseWikilinks(content);
  await pool.query(`DELETE FROM memory_links WHERE from_path = $1`, [relativePath]);
  for (const toName of links) {
    await pool.query(
      `INSERT INTO memory_links (from_path, to_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [relativePath, toName],
    );
  }
}

/** Notas vecinas de `fromPath` por [[wikilink]] saliente (1 hop), resueltas a document_path. */
async function linkedNotes(fromPath: string): Promise<string[]> {
  const { rows } = await pool.query<{ to_name: string }>(
    `SELECT to_name FROM memory_links WHERE from_path = $1`,
    [fromPath],
  );
  if (rows.length === 0) return [];
  const nameToPath = nameToPathMap();
  return rows.map((r) => nameToPath.get(r.to_name)).filter((p): p is string => !!p && p !== fromPath);
}

// Etiquetas de sección de MEMORY.md por categoría (= primer segmento del path,
// ej. "user/x.md" -> "user"). Editable a mano en memory/.categories.json — una
// categoría nueva (ej. "salud") NO necesita tocar código, cae al fallback de
// capitalizar el nombre de la carpeta si no está en el archivo (gap #6).
const CATEGORY_LABELS_FILE = path.join(MEMORY_DIR, ".categories.json");

function loadCategoryLabels(): Record<string, string> {
  if (!fs.existsSync(CATEGORY_LABELS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CATEGORY_LABELS_FILE, "utf-8"));
  } catch {
    return {}; // JSON roto a mano -> degrada al fallback, no rompe remember()/forget()
  }
}

function labelForCategory(category: string): string {
  const overrides = loadCategoryLabels();
  return overrides[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/** Saca de MEMORY.md cualquier bullet existente para `relativePath` (updates y forget). */
function removeIndexBullet(text: string, relativePath: string): string {
  return text
    .split("\n")
    .filter((l) => !l.startsWith(`- ${relativePath} `) && !l.startsWith(`- ${relativePath}—`))
    .join("\n");
}

function updateMemoryIndex(relativePath: string, description: string): void {
  const category = relativePath.split("/")[0];
  const label = labelForCategory(category);
  let text = fs.existsSync(MEMORY_INDEX)
    ? fs.readFileSync(MEMORY_INDEX, "utf-8").replace(/\r\n/g, "\n")
    : "# Memory Index\n";
  const bullet = `- ${relativePath} — ${description}`;
  const headerRe = new RegExp(`^## ${label}\\s*$`, "m");

  text = removeIndexBullet(text, relativePath); // saco cualquier bullet previo para este mismo path (updates)

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

/**
 * forget() — contraparte de remember() (gap #3): borra la nota del vault +
 * su fila de memory_embeddings + sus [[wikilinks]] salientes + su bullet en
 * MEMORY.md. false si el path no es una nota real (mismo chequeo anti path-
 * traversal que readNote()). No limpia links ENTRANTES de otras notas hacia
 * esta (quedan colgantes — un [[link]] colgante ya es válido en el vault).
 */
export async function forget(relativePath: string): Promise<boolean> {
  if (!relativePath.endsWith(".md")) relativePath += ".md";
  if (!listNoteFiles().includes(relativePath)) return false;

  fs.unlinkSync(path.join(MEMORY_DIR, relativePath));
  await pool.query(`DELETE FROM memory_embeddings WHERE document_path = $1`, [relativePath]);
  await pool.query(`DELETE FROM memory_links WHERE from_path = $1`, [relativePath]);

  if (fs.existsSync(MEMORY_INDEX)) {
    const text = removeIndexBullet(fs.readFileSync(MEMORY_INDEX, "utf-8").replace(/\r\n/g, "\n"), relativePath);
    fs.writeFileSync(MEMORY_INDEX, text.trimEnd() + "\n");
  }
  return true;
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
