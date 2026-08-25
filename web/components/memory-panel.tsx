"use client";

import { useEffect, useMemo, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

type Note = { path: string; type: string; name: string; description: string };

export function MemoryPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [renderedNote, setRenderedNote] = useState("");

  useEffect(() => {
    fetch("/api/memory")
      .then((r) => r.json())
      .then((data) => setNotes(data.notes || []))
      .catch(() => {});
  }, []);

  const groups = useMemo(() => {
    const byType = new Map<string, Note[]>();
    for (const n of notes) {
      const key = n.type || "otros";
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(n);
    }
    return [...byType.entries()].map(([type, notes]) => ({ type, notes }));
  }, [notes]);

  async function openNote(note: Note) {
    setSelected(note);
    setRenderedNote("cargando...");
    try {
      const res = await fetch(`/api/memory/note?path=${encodeURIComponent(note.path)}`);
      const data = await res.json();
      setRenderedNote(res.ok ? renderMarkdown(data.content) : "No se pudo cargar la nota.");
    } catch {
      setRenderedNote("No se pudo cargar la nota.");
    }
  }

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      <aside className="w-full md:w-72 max-h-40 md:max-h-none border-b md:border-b-0 md:border-r border-border/80 bg-panel/30 overflow-y-auto shrink-0">
        {groups.map((group) => (
          <div key={group.type} className="px-3 pt-4">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5 px-1.5">{group.type}</div>
            {group.notes.map((note) => {
              const active = selected?.path === note.path;
              return (
                <button
                  key={note.path}
                  onClick={() => openNote(note)}
                  className={cn(
                    "block w-full text-left px-2.5 py-2 rounded-lg mb-0.5 text-sm border-l-2 transition-colors duration-150",
                    active
                      ? "bg-panel2 text-white border-accent"
                      : "text-gray-300 border-transparent hover:bg-panel2/60 hover:border-border",
                  )}
                >
                  <div className="font-medium truncate">{note.name || note.path}</div>
                  <div className="text-xs text-muted truncate">{note.description}</div>
                </button>
              );
            })}
          </div>
        ))}
        {notes.length === 0 && <div className="px-4 py-6 text-sm text-muted">Vault vacío.</div>}
      </aside>
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        {!selected && <div className="text-muted text-sm">Elegí una nota de la izquierda.</div>}
        {selected && (
          <div className="max-w-2xl message-in">
            <div className="text-xs text-muted mb-1">{selected.path}</div>
            <h2 className="text-lg font-semibold text-white mb-4 tracking-tight">{selected.name || selected.path}</h2>
            <div className="prose-note text-[14.5px] text-gray-300" dangerouslySetInnerHTML={{ __html: renderedNote }} />
          </div>
        )}
      </div>
    </div>
  );
}
