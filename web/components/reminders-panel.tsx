"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCw, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Reminder = { id: number; text: string; run_at: string; cron_expr?: string | null; channels: string[] };

const CHANNEL_LABEL: Record<string, string> = { web: "Navegador", telegram: "Telegram" };

function channelsLabel(channels: string[]): string {
  return channels.map((c) => CHANNEL_LABEL[c] ?? c).join(" + ");
}

const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Mismos componentes de fecha en hora Lima que brain/router.ts (America/Lima,
// UTC-5 fijo) — para agrupar "Hoy"/"Mañana" sin depender de la zona del
// navegador (el VPS/servidor sí corre en UTC, pero acá corre en el cliente).
function limaMidnightUTC(d: Date): number {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day);
}

// Traduce un cron_expr "m h * * dow" a texto humano tipo Calendar,
// ej. "Cada día a las 08:00" / "Cada lunes a las 09:30".
function cronLabel(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [m, h, , , dow] = parts;
  const hh = h.padStart(2, "0");
  const mm = m.padStart(2, "0");
  if (dow === "*") return `Cada día a las ${hh}:${mm}`;
  const dayIdx = Number(dow);
  if (!Number.isNaN(dayIdx) && DOW[dayIdx]) return `Cada ${DOW[dayIdx]} a las ${hh}:${mm}`;
  return `A las ${hh}:${mm} (${cron})`;
}

// applicationServerKey de pushManager.subscribe() quiere un Uint8Array, no el
// string base64url que devuelve /api/web-push/public-key.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
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

// Cuenta regresiva ("en 3 min", "en 2 h") — pensado para debuggear que el
// server efectivamente calculó el run_at que corresponde (ver bug de sesión
// con hora congelada, session.ts limaNowISO por mensaje).
function countdownLabel(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "ya debería haber sonado";
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "en instantes";
  if (min < 60) return `en ${min} min`;
  const hours = Math.floor(min / 60);
  const restMin = min % 60;
  if (hours < 24) return restMin === 0 ? `en ${hours} h` : `en ${hours} h ${restMin} min`;
  const days = Math.floor(hours / 24);
  return `en ${days} d`;
}

// Fecha completa (día de semana + día + mes, sin año — recordatorios viven en el
// corto plazo) para el subtítulo de cada fila, independiente del header del
// grupo (que puede quedar fuera de vista al hacer scroll).
function fullDateLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long", day: "numeric", month: "long" });
  } catch {
    return iso;
  }
}

export function RemindersPanel({ active }: { active: boolean }) {
  const [reminders, setReminders] = useState<Reminder[] | null>(null); // null = todavía no cargó
  const [linked, setLinked] = useState<string[]>(["web"]); // canales realmente vinculados (ver /api/reminders GET)
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [freq, setFreq] = useState<"once" | "recurring">("once");
  const [when, setWhen] = useState(""); // datetime-local
  const [dow, setDow] = useState("*"); // '*' = diario, si no 0-6
  const [time, setTime] = useState("08:00");
  const [channels, setChannels] = useState<string[]>(["web", "telegram"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Push real al navegador (VAPID) — antes solo había polling con la
  // pestaña de Chat abierta. "unsupported" = navegador sin Push API o
  // backend sin VAPID_* configuradas (ver /api/web-push/public-key), estados
  // que se tratan igual porque de cualquier forma no hay nada que ofrecer.
  // "error" = el navegador SÍ tiene la suscripción (pushManager.getSubscription
  // no da null) pero el server no la tiene guardada — antes esto se mostraba
  // como "on" igual (nunca se chequeaba si el POST a /api/web-push/subscribe
  // salía bien), así que quedabas "activado" en la UI para siempre sin que
  // llegara un solo push real.
  const [pushStatus, setPushStatus] = useState<"checking" | "unsupported" | "denied" | "off" | "on" | "error">(
    "checking",
  );
  const [pushBusy, setPushBusy] = useState(false);

  // Manda la suscripción al server y devuelve si quedó guardada — se usa
  // tanto al activar como para re-sincronizar la que el navegador ya tenía.
  async function syncSubscription(sub: PushSubscription): Promise<boolean> {
    try {
      const res = await fetch("/api/web-push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setPushStatus("denied");
        return;
      }
      try {
        const keyRes = await fetch("/api/web-push/public-key");
        const { publicKey } = await keyRes.json();
        if (!publicKey) {
          setPushStatus("unsupported"); // servidor sin VAPID_* configuradas
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (!sub) {
          setPushStatus("off");
          return;
        }
        // El navegador ya está suscripto — re-sincroniza contra el server cada
        // vez que se abre el panel (barato, ON CONFLICT del lado del server)
        // en vez de asumir que porque el navegador la tiene, el server también.
        setPushStatus((await syncSubscription(sub)) ? "on" : "error");
      } catch {
        setPushStatus("unsupported");
      }
    })();
  }, []);

  async function enablePush() {
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus("denied");
        return;
      }
      const keyRes = await fetch("/api/web-push/public-key");
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        setPushStatus("unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const ok = await syncSubscription(sub);
      if (!ok) console.error("el navegador se suscribió pero el server no pudo guardar la suscripción");
      setPushStatus(ok ? "on" : "error");
    } catch (err) {
      console.error("no pude activar notificaciones:", err);
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/web-push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushStatus("off");
    } catch (err) {
      console.error("no pude desactivar notificaciones:", err);
    } finally {
      setPushBusy(false);
    }
  }

  async function load() {
    try {
      const res = await fetch("/api/reminders");
      const data = await res.json();
      setReminders(data.reminders || []);
      const linkedNow: string[] = data.linkedChannels || ["web"];
      setLinked(linkedNow);
      // Si el form todavía tiene marcado un canal que ya no está vinculado
      // (ej. se abrió antes de que cargara), lo destilda solo.
      setChannels((cs) => cs.filter((c) => linkedNow.includes(c)));
    } catch {
      // silencioso — la UI simplemente queda con lo último cargado
    }
  }

  // Antes era `[]` (solo al montar) — como el panel queda montado siempre
  // (ver app-shell.tsx, tabs no se desmontan al cambiar), un recordatorio
  // creado por chat mientras estabas en otra tab nunca aparecía acá hasta
  // recargar la página entera. Ahora refetch cada vez que la tab se activa.
  useEffect(() => {
    if (active) load();
  }, [active]);

  // countdownLabel() lee Date.now() al renderizar — sin esto la cuenta
  // regresiva de cada fila queda pegada al valor de cuando se hizo el último
  // fetch (fetch nuevo no llega solo porque pasa el tiempo). Fuerza un
  // re-render liviano cada 30s mientras la tab está activa, nada más.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => forceTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);

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
    if (channels.length === 0) {
      setError("Elegí al menos un canal.");
      return;
    }
    const body: Record<string, unknown> = { text: text.trim(), channels };
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
    const byTime = (a: Reminder, b: Reminder) => +new Date(a.run_at) - +new Date(b.run_at);
    const all = reminders ?? [];
    const recurring = all.filter((r) => r.cron_expr).sort(byTime);
    const once = all.filter((r) => !r.cron_expr).sort(byTime);
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

            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Qué te tengo que recordar" />

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted">Cuándo</span>
              <div className="inline-flex self-start rounded-lg border border-border bg-panel2 p-0.5">
                <Button
                  type="button"
                  variant={freq === "once" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setFreq("once")}
                  className="h-7 px-3 text-xs"
                >
                  Puntual
                </Button>
                <Button
                  type="button"
                  variant={freq === "recurring" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setFreq("recurring")}
                  className="h-7 px-3 text-xs"
                >
                  Recurrente
                </Button>
              </div>
              {freq === "once" ? (
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              ) : (
                <div className="flex gap-2">
                  <Select value={dow} onChange={(e) => setDow(e.target.value)} className="flex-1">
                    <option value="*">Todos los días</option>
                    {DOW.map((d, i) => (
                      <option key={i} value={i}>
                        Cada {d}
                      </option>
                    ))}
                  </Select>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted">Avisar por</span>
              <div className="flex gap-4">
                <Checkbox
                  label="Navegador"
                  checked={channels.includes("web")}
                  onChange={(e) =>
                    setChannels((cs) => (e.target.checked ? [...cs, "web"] : cs.filter((c) => c !== "web")))
                  }
                />
                <Checkbox
                  label="Telegram"
                  checked={channels.includes("telegram")}
                  disabled={!linked.includes("telegram")}
                  hint={!linked.includes("telegram") ? "No tenés Telegram vinculado a esta cuenta" : undefined}
                  onChange={(e) =>
                    setChannels((cs) => (e.target.checked ? [...cs, "telegram"] : cs.filter((c) => c !== "telegram")))
                  }
                />
              </div>
            </div>

            <Button onClick={create} disabled={saving} size="sm" className="self-start">
              {saving ? "Creando..." : "Crear"}
            </Button>
          </div>
        )}

        {reminders === null && <div className="text-sm text-muted">Cargando...</div>}
        {reminders !== null && reminders.length === 0 && (
          <div className="text-sm text-muted">No hay recordatorios pendientes.</div>
        )}

        {recurring.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5 px-1">Recurrentes</div>
            <div className="flex flex-col gap-2.5">
              {recurring.map((r) => (
                <ReminderRow key={r.id} r={r} onCancel={cancel} mode="recurring" />
              ))}
            </div>
          </div>
        )}

        {[...byDay.entries()].map(([label, items]) => (
          <div key={label} className="mb-5">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5 px-1">{label}</div>
            <div className="flex flex-col gap-2.5">
              {items.map((r) => (
                <ReminderRow key={r.id} r={r} onCancel={cancel} mode="day" />
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between gap-2 mt-2 px-1">
          <p className={cn("text-xs", pushStatus === "error" ? "text-red-400" : "text-muted")}>
            {pushStatus === "on" && "Notificaciones del navegador activadas — llegan aunque esta pestaña esté cerrada."}
            {pushStatus === "off" && "Los creados acá también se pueden avisar por notificación del navegador."}
            {pushStatus === "error" &&
              "El navegador está suscripto pero el server no pudo guardarlo — probá de nuevo."}
            {pushStatus === "denied" && "Notificaciones bloqueadas — habilitalas en los permisos del sitio para activarlas."}
            {pushStatus === "unsupported" && "Este navegador no soporta notificaciones push (o el servidor no las tiene configuradas)."}
            {pushStatus === "checking" && "Revisando notificaciones del navegador..."}
          </p>
          {(pushStatus === "off" || pushStatus === "error") && (
            <Button variant="outline" size="sm" onClick={enablePush} disabled={pushBusy} className="text-xs shrink-0">
              {pushBusy ? "Activando..." : pushStatus === "error" ? "Reintentar" : "Activar notificaciones"}
            </Button>
          )}
          {pushStatus === "on" && (
            <Button variant="ghost" size="sm" onClick={disablePush} disabled={pushBusy} className="text-xs shrink-0">
              {pushBusy ? "Desactivando..." : "Desactivar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReminderRow({ r, onCancel, mode }: { r: Reminder; onCancel: (id: number) => void; mode: "day" | "recurring" }) {
  // "day": header del grupo ("Hoy"/"Mañana") puede quedar fuera de vista al
  // scrollear → el subtítulo repite la fecha completa, no solo depende de él.
  // "recurring": no hay grupo por día → mostrar próximo run relativo (día + hora).
  const subtitle =
    mode === "day"
      ? `${fullDateLabel(r.run_at)} · ${countdownLabel(r.run_at)} · no se repite · ${channelsLabel(r.channels)}`
      : `${cronLabel(r.cron_expr!)} · próximo ${dayLabel(r.run_at)} ${timeLabel(r.run_at)} (${countdownLabel(r.run_at)}) · ${channelsLabel(r.channels)}`;
  return (
    <div className="flex items-center justify-between gap-3 bg-panel border border-border rounded-xl px-4 py-3 transition-colors hover:border-panel3">
      {mode === "day" && (
        <div className="text-sm font-semibold text-gray-100 tabular-nums shrink-0 w-14">{timeLabel(r.run_at)}</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm text-gray-200 truncate">
          {r.cron_expr && <span title={`cron: ${r.cron_expr}`}>🔁 </span>}
          {r.text}
        </div>
        <div className="text-xs text-muted">{subtitle}</div>
      </div>
      <Button variant="destructive" size="sm" onClick={() => onCancel(r.id)} className="shrink-0">
        Cancelar
      </Button>
    </div>
  );
}
