"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

type FiredNotification = { id: number; text: string; time: string };

// Recordatorios ya disparados (canal 'web', ver scheduler.ts) — antes vivían
// mezclados en el Chat como burbujas de bot, después como sub-sección dentro
// de Avisos; ahora tienen su propia tab. Sigue pollingeando aunque el
// usuario esté en otra tab (este panel queda siempre montado, ver
// app-shell.tsx) — así llega igual y está esperando cuando volvés acá.
export function NotificationsPanel() {
  const [fired, setFired] = useState<FiredNotification[]>([]);
  // Ids ya vistos — el endpoint devuelve por ventana de tiempo (15 min), no
  // por "no leídas" (así varias pestañas/dispositivos pollingeando a la vez
  // no se pisan) — el dedupe de "ya la mostré" queda acá, del lado del cliente.
  const seenNotificationIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    function poll() {
      fetch("/api/web-notifications")
        .then((r) => r.json())
        .then((data) => {
          const notifications: Array<{ id: number; text: string }> = data.notifications || [];
          const fresh = notifications.filter((n) => !seenNotificationIds.current.has(n.id));
          if (fresh.length === 0) return;
          for (const n of fresh) seenNotificationIds.current.add(n.id);
          const time = new Date().toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" });
          setFired((f) => [...fresh.map((n) => ({ ...n, time })), ...f].slice(0, 30));
          // Notificación real del sistema si ya hay permiso concedido — no
          // depende de tener push (VAPID) armado, solo de permiso + esta
          // pestaña abierta (el push real cubre el caso de pestaña/navegador
          // cerrado, ver reminders-panel.tsx).
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            for (const n of fresh) new Notification("Robin ⏰", { body: n.text, tag: `robin-web-notif-${n.id}` });
          }
        })
        .catch(() => {});
    }
    poll(); // primer chequeo inmediato al montar, no esperar 20s
    const id = setInterval(poll, 20_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h2 className="text-base font-semibold text-white tracking-tight">Notificaciones</h2>
          {fired.length > 0 && (
            <button onClick={() => setFired([])} className="text-xs text-muted hover:text-gray-300">
              Limpiar
            </button>
          )}
        </div>

        {fired.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Bell size={22} className="text-muted" strokeWidth={1.75} />
            <p className="text-sm text-muted">Nada todavía — acá van a aparecer los recordatorios cuando disparen.</p>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {fired.map((n) => (
            <div key={n.id} className="flex items-start gap-2.5 bg-panel border border-accent/25 rounded-xl px-4 py-3">
              <span className="text-base leading-none mt-0.5">⏰</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-200">{n.text}</div>
                <div className="text-xs text-muted">{n.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
