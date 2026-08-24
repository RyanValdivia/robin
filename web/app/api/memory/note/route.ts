import { NextRequest, NextResponse } from "next/server";
import { readNote } from "@brain/memory.ts";

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
