"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCw, Plus, X, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type AgendaBlock = {
  id: number;
  label: string;
  day_of_week: number | null; // 0=domingo..6=sábado
  date: string | null; // "YYYY-MM-DD"
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

// Mismo orden que DOW_NAMES en tools.ts y el DOW de reminders-panel.tsx
// (0=domingo) — consistente en toda la app, no reindexado acá.
const DOW_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DOW_FULL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 23;
const HOUR_PX = 44;

// Antes la grilla era fija 6-23 y cualquier bloque fuera de ese rango quedaba
// cortado/oculto ("no lo veo completo") — ahora se expande (con 1h de
// margen) para que TODO bloque recurrente entre.
function computeHourBounds(blocks: AgendaBlock[]): [number, number] {
  let start = DEFAULT_START_HOUR;
  let end = DEFAULT_END_HOUR;
  for (const b of blocks) {
    if (b.day_of_week === null) continue;
    const s = Math.floor(toMinutes(b.start_time) / 60) - 1;
    const e = Math.ceil(toMinutes(b.end_time) / 60) + 1;
    if (s < start) start = s;
    if (e > end) end = e;
  }
  return [Math.max(0, start), Math.min(24, end)];
}

function hhmm(t: string): string {
  return t.slice(0, 5); // "08:00:00" -> "08:00", tolera "08:00" también
}

function toMinutes(t: string): number {
  const [h, m] = hhmm(t).split(":").map(Number);
  return h * 60 + m;
}

function limaDayOfWeek(): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

function dateLabel(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("es-PE", {
      timeZone: "America/Lima",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return iso;
  }
}

export function AgendaPanel({ active }: { active: boolean }) {
  const [blocks, setBlocks] = useState<AgendaBlock[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [freq, setFreq] = useState<"recurring" | "once">("recurring");
  const [dow, setDow] = useState("1"); // lunes por default, es el caso más común (clase/trabajo)
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/agenda");
      const data = await res.json();
      setBlocks(data.blocks || []);
    } catch {
      // silencioso — la UI queda con lo último cargado
    }
  }

  useEffect(() => {
    if (active) load();
  }, [active]);

  async function create() {
    if (!label.trim()) {
      setError("Falta la etiqueta.");
      return;
    }
    if (freq === "once" && !date) {
      setError("Falta la fecha.");
      return;
    }
    if (startTime >= endTime) {
      setError("La hora de inicio tiene que ser antes que la de fin.");
      return;
    }
    const body: Record<string, unknown> = {
      label: label.trim(),
      start_time: startTime,
      end_time: endTime,
      ...(freq === "recurring" ? { day_of_week: Number(dow) } : { date }),
    };
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No pude agregar el bloque.");
        return;
      }
      setLabel("");
      setDate("");
      setShowForm(false);
      await load();
    } catch {
      setError("No pude conectar con el servidor.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await fetch(`/api/agenda/${id}/delete`, { method: "POST" });
      await load();
    } catch {
      // ídem
    }
  }

  const { recurringByDay, upcoming } = useMemo(() => {
    const all = blocks ?? [];
    const recurringByDay = new Map<number, AgendaBlock[]>();
    for (const b of all) {
      if (b.day_of_week === null) continue;
      if (!recurringByDay.has(b.day_of_week)) recurringByDay.set(b.day_of_week, []);
      recurringByDay.get(b.day_of_week)!.push(b);
    }
    const upcoming = all
      .filter((b) => b.date !== null)
      .sort((a, b) => a.date!.localeCompare(b.date!) || a.start_time.localeCompare(b.start_time));
    return { recurringByDay, upcoming };
  }, [blocks]);

  const today = limaDayOfWeek();
  const [startHour, endHour] = useMemo(() => computeHourBounds(blocks ?? []), [blocks]);
  const gridHeight = (endHour - startHour) * HOUR_PX;
  const hourMarks = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h2 className="text-base font-semibold text-white tracking-tight">Horario</h2>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 text-xs">
              <RotateCw size={13} /> Actualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowForm((s) => !s)} className="gap-1.5 text-xs">
              {showForm ? <X size={13} /> : <Plus size={13} />} {showForm ? "Cerrar" : "Nuevo"}
            </Button>
          </div>
        </div>

        {showForm && (
          <div className="bg-panel border border-border rounded-xl p-4 mb-5 flex flex-col gap-4">
            {error && <div className="text-xs text-red-400">{error}</div>}

            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Qué es (ej. Clase de cálculo)" />

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted">Cuándo</span>
              <div className="inline-flex self-start rounded-lg border border-border bg-panel2 p-0.5">
                <Button
                  type="button"
                  variant={freq === "recurring" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setFreq("recurring")}
                  className="h-7 px-3 text-xs"
                >
                  Se repite cada semana
                </Button>
                <Button
                  type="button"
                  variant={freq === "once" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setFreq("once")}
                  className="h-7 px-3 text-xs"
                >
                  Fecha puntual
                </Button>
              </div>
              {freq === "recurring" ? (
                <Select value={dow} onChange={(e) => setDow(e.target.value)}>
                  {DOW_FULL.map((d, i) => (
                    <option key={i} value={i}>
                      Cada {d}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted">Horario</span>
              <div className="flex items-center gap-2">
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-32" />
                <span className="text-sm text-muted">a</span>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-32" />
              </div>
            </div>

            <Button onClick={create} disabled={saving} size="sm" className="self-start">
              {saving ? "Agregando..." : "Agregar"}
            </Button>
          </div>
        )}

        {blocks === null && <div className="text-sm text-muted mb-4">Cargando...</div>}

        {blocks !== null && blocks.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <CalendarDays size={22} className="text-muted" strokeWidth={1.75} />
            <p className="text-sm text-muted">Todavía no cargaste tu horario.</p>
          </div>
        )}

        {blocks !== null && blocks.length > 0 && (
          // Antes: header y grilla eran dos <div className="flex"> separados
          // (podían desalinearse) sin tope de alto (la página entera scrolleaba
          // un bloque fijo de ~750px). Ahora es UNA sola CSS grid (columnas
          // garantizadas iguales entre el header y el cuerpo) metida en su
          // propio contenedor con scroll (vertical Y horizontal), con el
          // header y el gutter de horas sticky para no perder la referencia.
          <div className="rounded-xl border border-border/60 overflow-auto mb-6 max-h-[65vh]">
            <div
              className="grid"
              style={{ gridTemplateColumns: `44px repeat(7, minmax(88px, 1fr))`, minWidth: 44 + 88 * 7 }}
            >
              <div className="sticky top-0 left-0 z-30 bg-panel border-b border-r border-border/60" />
              {DOW_SHORT.map((d, i) => (
                <div
                  key={`h-${i}`}
                  className={cn(
                    "sticky top-0 z-20 bg-panel text-center text-xs font-medium py-2 border-b border-border/60",
                    i === today ? "text-accent" : "text-muted",
                  )}
                >
                  {d}
                </div>
              ))}

              <div className="sticky left-0 z-20 bg-panel border-r border-border/60 relative" style={{ height: gridHeight }}>
                {hourMarks.map((h) => (
                  <div
                    key={h}
                    className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted tabular-nums"
                    style={{ top: (h - startHour) * HOUR_PX }}
                  >
                    {String(h).padStart(2, "0")}:00
                  </div>
                ))}
              </div>
              {DOW_SHORT.map((_, dayIdx) => (
                <div
                  key={dayIdx}
                  className={cn("relative border-r border-border/30 last:border-r-0", dayIdx === today && "bg-accent/[0.04]")}
                  style={{ height: gridHeight }}
                >
                  {hourMarks.slice(0, -1).map((h) => (
                    <div
                      key={h}
                      className="absolute w-full border-t border-border/30"
                      style={{ top: (h - startHour) * HOUR_PX }}
                    />
                  ))}
                  {(recurringByDay.get(dayIdx) ?? []).map((b) => {
                    const top = Math.max(0, toMinutes(b.start_time) - startHour * 60) * (HOUR_PX / 60);
                    const height = Math.max(20, (toMinutes(b.end_time) - toMinutes(b.start_time)) * (HOUR_PX / 60));
                    return (
                      <button
                        key={b.id}
                        onClick={() => remove(b.id)}
                        title={`${hhmm(b.start_time)}-${hhmm(b.end_time)} · click para borrar`}
                        className="absolute left-0.5 right-0.5 rounded-md bg-accent/15 border border-accent/40 px-1.5 py-0.5 text-left overflow-hidden hover:bg-accent/25 transition-colors"
                        style={{ top, height }}
                      >
                        <div className="text-[10px] font-medium text-accent leading-tight truncate">{b.label}</div>
                        <div className="text-[9px] text-accent/70 leading-tight truncate">
                          {hhmm(b.start_time)}-{hhmm(b.end_time)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {upcoming.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5 px-1">Fechas puntuales</div>
            <div className="flex flex-col gap-2.5">
              {upcoming.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-3 bg-panel border border-border rounded-xl px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-200 truncate">{b.label}</div>
                    <div className="text-xs text-muted">
                      {dateLabel(b.date!)} · {hhmm(b.start_time)}-{hhmm(b.end_time)}
                    </div>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => remove(b.id)} className="shrink-0">
                    Borrar
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
