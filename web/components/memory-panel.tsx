"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Note = { path: string; type: string; name: string; description: string };
type Mode = "view" | "edit" | "create";
type EditorTab = "write" | "preview";

const TYPES = ["user", "project", "infrastructure", "reference"] as const;

const emptyForm = { relative_path: "", type: "user" as string, name: "", description: "", content: "" };

export function MemoryPanel({ active }: { active: boolean }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [rawContent, setRawContent] = useState("");
  const [mode, setMode] = useState<Mode>("view");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorTab, setEditorTab] = useState<EditorTab>("write");
  // Autocomplete de [[wikilinks]]: linkQuery !== null mientras el cursor está
  // dentro de un "[[algo" sin cerrar — se recalcula en cada tecla (onSelect
  // cubre click/flechas, no solo tipeo). No sigue el caret en píxeles (la
  // lista queda pegada bajo el textarea, no flotando exacto en el cursor) —
  // simplificación a propósito, mismo espíritu minimalista del resto.
  const [linkQuery, setLinkQuery] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  function loadNotes() {
    fetch("/api/memory")
      .then((r) => r.json())
      .then((data) => setNotes(data.notes || []))
      .catch(() => {});
  }

  // Refetch al activarse la tab (no solo al montar) — mismo motivo que
  // reminders-panel.tsx: el panel queda montado siempre, una nota creada por
  // chat/`remember()` mientras estabas en otra tab no aparecía sin recargar.
  useEffect(() => {
    if (active) loadNotes();
  }, [active]);

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
    setMode("view");
    setError("");
    setRawContent("cargando...");
    try {
      const res = await fetch(`/api/memory/note?path=${encodeURIComponent(note.path)}`);
      const data = await res.json();
      setRawContent(res.ok ? data.content : "");
      if (!res.ok) setError("No se pudo cargar la nota.");
    } catch {
      setRawContent("");
      setError("No se pudo cargar la nota.");
    }
  }

  function startCreate() {
    setSelected(null);
    setForm(emptyForm);
    setError("");
    setEditorTab("write");
    setLinkQuery(null);
    setMode("create");
  }

  function startEdit() {
    if (!selected) return;
    setForm({ relative_path: selected.path, type: selected.type || "user", name: selected.name, description: selected.description, content: rawContent });
    setError("");
    setEditorTab("write");
    setLinkQuery(null);
    setMode("edit");
  }

  // Detecta si el cursor quedó dentro de un "[[algo" sin cerrar, para mostrar
  // sugerencias de notas existentes (gap #8 — antes no había autocomplete).
  function checkLinkQuery(value: string, cursor: number) {
    const before = value.slice(0, cursor);
    const m = /\[\[([^\]]*)$/.exec(before);
    setLinkQuery(m ? m[1] : null);
  }

  function onContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setForm((f) => ({ ...f, content: value }));
    checkLinkQuery(value, e.target.selectionStart ?? value.length);
  }

  const linkSuggestions = useMemo(() => {
    if (linkQuery === null) return [];
    const q = linkQuery.toLowerCase();
    return notes.filter((n) => (n.name || n.path).toLowerCase().includes(q)).slice(0, 6);
  }, [linkQuery, notes]);

  function insertLink(note: Note) {
    const el = contentRef.current;
    if (!el) return;
    const value = form.content;
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const m = /\[\[([^\]]*)$/.exec(before);
    if (!m) return;
    const start = before.length - m[0].length;
    const name = note.name || note.path.replace(/\.md$/, "").split("/").pop() || note.path;
    const insertText = `[[${name}]]`;
    const newValue = value.slice(0, start) + insertText + value.slice(cursor);
    setForm((f) => ({ ...f, content: newValue }));
    setLinkQuery(null);
    requestAnimationFrame(() => {
      const pos = start + insertText.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  async function save() {
    if (!form.relative_path.trim() || !form.name.trim()) {
      setError("Ruta y nombre son obligatorios.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/memory/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No pude guardar.");
        return;
      }
      loadNotes();
      const path = form.relative_path.endsWith(".md") ? form.relative_path : `${form.relative_path}.md`;
      setSelected({ path, type: form.type, name: form.name, description: form.description });
      setRawContent(form.content);
      setMode("view");
    } catch {
      setError("No pude conectar con el servidor.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected) return;
    if (!confirm(`¿Borrar "${selected.name || selected.path}"? No se puede deshacer.`)) return;
    try {
      await fetch(`/api/memory/note?path=${encodeURIComponent(selected.path)}`, { method: "DELETE" });
      setSelected(null);
      setMode("view");
      loadNotes();
    } catch {
      setError("No pude borrar la nota.");
    }
  }

  const renderedNote = useMemo(() => renderMarkdown(rawContent), [rawContent]);

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      <aside className="w-full md:w-72 max-h-40 md:max-h-none border-b md:border-b-0 md:border-r border-border/80 bg-panel/30 overflow-y-auto shrink-0">
        <div className="px-3 pt-3">
          <Button size="sm" variant="outline" onClick={startCreate} className="w-full gap-1.5">
            <Plus size={14} /> Nueva nota
          </Button>
        </div>
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
        {mode === "view" && !selected && <div className="text-muted text-sm">Elegí una nota de la izquierda, o creá una nueva.</div>}

        {mode === "view" && selected && (
          <div className="max-w-2xl message-in">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div>
                <div className="text-xs text-muted mb-1">{selected.path}</div>
                <h2 className="text-lg font-semibold text-white tracking-tight">{selected.name || selected.path}</h2>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="icon-sm" variant="ghost" onClick={startEdit} title="Editar">
                  <Pencil size={15} />
                </Button>
                <Button size="icon-sm" variant="destructive" onClick={remove} title="Borrar">
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
            {error && <div className="text-xs text-red-400 mb-3">{error}</div>}
            <div className="prose-note text-[14.5px] text-gray-300 mt-4" dangerouslySetInnerHTML={{ __html: renderedNote }} />
          </div>
        )}

        {(mode === "edit" || mode === "create") && (
          <div className="max-w-2xl message-in flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-white tracking-tight mb-1">
              {mode === "create" ? "Nueva nota" : "Editar nota"}
            </h2>
            {error && <div className="text-xs text-red-400">{error}</div>}

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-muted">Ruta (dentro de memory/)</span>
              <Input
                value={form.relative_path}
                disabled={mode === "edit"}
                onChange={(e) => setForm((f) => ({ ...f, relative_path: e.target.value }))}
                placeholder="user/preferencias.md"
              />
            </label>

            <div className="flex gap-3">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-[11px] uppercase tracking-wide text-muted">Tipo</span>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="h-9 rounded-lg border border-border bg-panel px-2.5 text-sm text-gray-200 focus:outline-none focus:border-accent/60"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 flex-[2]">
                <span className="text-[11px] uppercase tracking-wide text-muted">Nombre</span>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nombre corto" />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-muted">Descripción (una línea, va en el índice)</span>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </label>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-muted">Contenido (markdown)</span>
                <div className="flex gap-1">
                  {(["write", "preview"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setEditorTab(t)}
                      className={cn(
                        "px-2 py-0.5 rounded text-[11px] transition-colors",
                        editorTab === t ? "bg-panel2 text-white" : "text-muted hover:text-gray-200",
                      )}
                    >
                      {t === "write" ? "Editar" : "Preview"}
                    </button>
                  ))}
                </div>
              </div>

              {editorTab === "preview" ? (
                <div
                  className="prose-note text-[14.5px] text-gray-300 rounded-lg border border-border bg-panel p-3 min-h-[280px]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(form.content || "*(vacío)*") }}
                />
              ) : (
                <div className="relative">
                  <Textarea
                    ref={contentRef}
                    value={form.content}
                    onChange={onContentChange}
                    onSelect={(e) => checkLinkQuery(form.content, e.currentTarget.selectionStart ?? 0)}
                    onBlur={() => setLinkQuery(null)}
                    rows={14}
                    className="rounded-lg border border-border bg-panel p-3 font-mono text-[13px] leading-relaxed"
                  />
                  {linkQuery !== null && linkSuggestions.length > 0 && (
                    <div className="absolute left-2 right-2 top-full mt-1 z-10 bg-panel2 border border-border rounded-lg shadow-lg overflow-hidden">
                      {linkSuggestions.map((n) => (
                        <button
                          key={n.path}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()} // evita el blur del textarea antes del click
                          onClick={() => insertLink(n)}
                          className="block w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-panel3"
                        >
                          {n.name || n.path}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-1">
              <Button onClick={save} disabled={saving} className="gap-1.5">
                <Save size={14} /> {saving ? "Guardando..." : "Guardar"}
              </Button>
              <Button variant="outline" onClick={() => setMode("view")} className="gap-1.5">
                <X size={14} /> Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
