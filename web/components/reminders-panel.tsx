"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCw, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Reminder = { id: number; text: string; run_at: string; cron_expr?: string | null };

const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-PE", { timeZone: "America/Lima" });
  } catch {
    return iso;
  }
}

// Mismos componentes de fecha en hora Lima que brain/router.ts (America/Lima,
// UTC-5 fijo) — para agrupar "Hoy"/"Mañana" sin depender de la zona del
// navegador (el VPS/servidor sí corre en UTC, pero acá corre en el cliente).
function limaMidnightUTC(d: Date): number {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.round((limaMidnightUTC(d) - limaMidnightUTC(new Date())) / 86_400_000);
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Mañana";
  if (diffDays < 0) return "Vencido"; // no debería pasar (solo se listan pendientes), pero por las dudas
  if (diffDays < 7) return d.toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long" });
  return d.toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "numeric", month: "long" });
}

export function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [freq, setFreq] = useState<"once" | "recurring">("once");
  const [when, setWhen] = useState(""); // datetime-local
  const [dow, setDow] = useState("*"); // '*' = diario, si no 0-6
  const [time, setTime] = useState("08:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/reminders");
      const data = await res.json();
      setReminders(data.reminders || []);
    } catch {
      // silencioso — la UI simplemente queda con lo último cargado
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function cancel(id: number) {
    try {
      await fetch(`/api/reminders/${id}/cancel`, { method: "POST" });
      await load();
    } catch {
      // ídem
    }
  }

  async function create() {
    if (!text.trim()) {
      setError("Falta el texto.");
      return;
    }
    const body: Record<string, string> = { text: text.trim() };
    if (freq === "once") {
      if (!when) {
        setError("Falta fecha/hora.");
        return;
      }
      body.run_at_iso = new Date(when).toISOString();
    } else {
      const [h, m] = time.split(":");
      body.cron_expr = `${+m} ${+h} * * ${dow}`;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No pude crear el recordatorio.");
        return;
      }
      setText("");
      setWhen("");
      setShowForm(false);
      await load();
    } catch {
      setError("No pude conectar con el servidor.");
    } finally {
      setSaving(false);
    }
  }

  const { recurring, byDay } = useMemo(() => {
    const recurring = reminders.filter((r) => r.cron_expr);
    const once = reminders.filter((r) => !r.cron_expr);
    const byDay = new Map<string, Reminder[]>();
    for (const r of once) {
      const label = dayLabel(r.run_at);
      if (!byDay.has(label)) byDay.set(label, []);
      byDay.get(label)!.push(r);
    }
    return { recurring, byDay };
  }, [reminders]);

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h2 className="text-base font-semibold text-white tracking-tight">Recordatorios</h2>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 text-xs">
              <RotateCw size={13} /> actualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowForm((s) => !s)} className="gap-1.5 text-xs">
              {showForm ? <X size={13} /> : <Plus size={13} />} {showForm ? "cerrar" : "nuevo"}
            </Button>
          </div>
        </div>

        {showForm && (
          <div className="bg-panel border border-border rounded-xl p-4 mb-5 flex flex-col gap-3">
            {error && <div className="text-xs text-red-400">{error}</div>}
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Qué te tengo que recordar" />
            <div className="flex gap-4 text-sm text-gray-300">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={freq === "once"} onChange={() => setFreq("once")} /> puntual
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={freq === "recurring"} onChange={() => setFreq("recurring")} /> recurrente
              </label>
            </div>
            {freq === "once" ? (
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            ) : (
              <div className="flex gap-2">
                <select
                  value={dow}
                  onChange={(e) => setDow(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-panel px-2.5 text-sm text-gray-200 focus:outline-none focus:border-accent/60"
                >
                  <option value="*">Todos los días</option>
                  {DOW.map((d, i) => (
                    <option key={i} value={i}>
                      Cada {d}
                    </option>
                  ))}
                </select>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
              </div>
            )}
            <Button onClick={create} disabled={saving} size="sm" className="self-start">
              {saving ? "Creando..." : "Crear"}
            </Button>
          </div>
        )}

        {reminders.length === 0 && <div className="text-sm text-muted">No hay recordatorios pendientes.</div>}

        {recurring.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5 px-1">Recurrentes</div>
            <div className="flex flex-col gap-2.5">
              {recurring.map((r) => (
                <ReminderRow key={r.id} r={r} onCancel={cancel} />
              ))}
            </div>
          </div>
        )}

        {[...byDay.entries()].map(([label, items]) => (
          <div key={label} className="mb-5">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5 px-1">{label}</div>
            <div className="flex flex-col gap-2.5">
              {items.map((r) => (
                <ReminderRow key={r.id} r={r} onCancel={cancel} />
              ))}
            </div>
          </div>
        ))}

        <p className="text-xs text-muted mt-2">
          Los creados acá se entregan por Telegram (todavía no hay push al navegador).
        </p>
      </div>
    </div>
  );
}

function ReminderRow({ r, onCancel }: { r: Reminder; onCancel: (id: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-panel border border-border rounded-xl px-4 py-3 transition-colors hover:border-panel3">
      <div className="min-w-0">
        <div className="text-sm text-gray-200 truncate">
          {r.cron_expr && <span title={`cron: ${r.cron_expr}`}>🔁 </span>}
          {r.text}
        </div>
        <div className="text-xs text-muted">{r.cron_expr ? `próximo: ${formatDate(r.run_at)}` : formatDate(r.run_at)}</div>
      </div>
      <Button variant="destructive" size="sm" onClick={() => onCancel(r.id)} className="shrink-0">
        cancelar
      </Button>
    </div>
  );
}
