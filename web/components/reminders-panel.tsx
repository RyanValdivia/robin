"use client";

import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Reminder = { id: number; text: string; run_at: string };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-PE", { timeZone: "America/Lima" });
  } catch {
    return iso;
  }
}

export function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[]>([]);

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

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Recordatorios pendientes</h2>
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 text-xs">
            <RotateCw size={13} /> actualizar
          </Button>
        </div>
        {reminders.length === 0 && <div className="text-sm text-muted">No hay recordatorios pendientes.</div>}
        <div className="flex flex-col gap-2.5">
          {reminders.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 bg-panel border border-border rounded-xl px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm text-gray-200 truncate">{r.text}</div>
                <div className="text-xs text-muted">{formatDate(r.run_at)}</div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => cancel(r.id)} className="shrink-0">
                cancelar
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-6">
          Los creados acá se entregan por Telegram (todavía no hay push al navegador).
        </p>
      </div>
    </div>
  );
}
