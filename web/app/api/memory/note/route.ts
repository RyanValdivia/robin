import { NextRequest, NextResponse } from "next/server";
import { readNote, remember, forget, type NoteMeta } from "@brain/memory.ts";

export const runtime = "nodejs";

// `path` va como query param — readNote() valida contra la lista real de
// notas del vault, así que un path arbitrario devuelve 404, no lee nada
// fuera de memory/ (sin riesgo de path traversal).
export async function GET(req: NextRequest) {
  const relPath = req.nextUrl.searchParams.get("path") ?? "";
  const content = readNote(relPath);
  if (content === null) {
    return NextResponse.json({ error: "nota no encontrada" }, { status: 404 });
  }
  return NextResponse.json({ path: relPath, content });
}

const VALID_TYPES: NoteMeta["type"][] = ["user", "project", "infrastructure", "reference"];

// Crear/editar una nota directo desde la Web UI — mismo remember() que usa
// AGENT por chat (tool en tools.ts), así el índice semántico y MEMORY.md
// nunca quedan desincronizados sea cual sea el origen de la escritura.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const relative_path = typeof body?.relative_path === "string" ? body.relative_path.trim() : "";
  const type = body?.type;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";

  if (!relative_path || !name || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "faltan campos (relative_path, type válido, name)" }, { status: 400 });
  }
  try {
    await remember(relative_path, { type, name, description }, content);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[web] error guardando nota:", err);
    return NextResponse.json({ error: "no pude guardar la nota" }, { status: 500 });
  }
}

// Borrar una nota — mismo forget() que la tool de AGENT (gap #3, ver memoria.ts).
export async function DELETE(req: NextRequest) {
  const relPath = req.nextUrl.searchParams.get("path") ?? "";
  try {
    const ok = await forget(relPath);
    if (!ok) return NextResponse.json({ error: "nota no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[web] error borrando nota:", err);
    return NextResponse.json({ error: "no pude borrar la nota" }, { status: 500 });
  }
}
