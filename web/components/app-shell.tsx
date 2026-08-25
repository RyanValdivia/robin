"use client";

import { useState } from "react";
import { MessageCircle, BookOpen, AlarmClock, BarChart3 } from "lucide-react";
import { ChatPanel } from "@/components/chat-panel";
import { MemoryPanel } from "@/components/memory-panel";
import { RemindersPanel } from "@/components/reminders-panel";
import { UsagePanel } from "@/components/usage-panel";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "memory", label: "Memoria", icon: BookOpen },
  { id: "reminders", label: "Avisos", icon: AlarmClock },
  { id: "usage", label: "Uso", icon: BarChart3 },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-indigo-400 flex items-center justify-center shadow-sm shadow-accent/30">
        <span className="text-[13px] font-semibold text-white">R</span>
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-panel" />
      </div>
      <h1 className="text-[13.5px] font-semibold text-white tracking-tight">Robin</h1>
    </div>
  );
}

export function AppShell() {
  const [tab, setTab] = useState<TabId>("chat");

  return (
    <div className="h-dvh flex flex-col bg-bg">
      {/* Header — angosto, con blur, mismo criterio que Linear/Claude
          (brand a la izquierda, sin ruido). La navegación vive en el rail
          lateral en desktop y en el bottom nav en mobile. */}
      <header className="flex items-center px-3 sm:px-4 h-14 border-b border-border/80 bg-panel/70 backdrop-blur-md shrink-0">
        <Brand />
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Rail lateral — solo desktop, patrón Linear: ícono + label, pill
            activa con fondo tenue y texto/ícono en acento. */}
        <nav className="hidden md:flex w-56 flex-col gap-0.5 border-r border-border/80 bg-panel/40 p-2.5 shrink-0">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150",
                  active ? "bg-panel2 text-white" : "text-muted hover:bg-panel2/60 hover:text-gray-200",
                )}
              >
                <Icon size={17} strokeWidth={2} className={active ? "text-accent" : ""} />
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-hidden">
          <div className={cn("h-full", tab !== "chat" && "hidden")}>
            <ChatPanel />
          </div>
          <div className={cn("h-full", tab !== "memory" && "hidden")}>
            <MemoryPanel />
          </div>
          <div className={cn("h-full", tab !== "reminders" && "hidden")}>
            <RemindersPanel />
          </div>
          <div className={cn("h-full", tab !== "usage" && "hidden")}>
            <UsagePanel />
          </div>
        </div>
      </div>

      {/* Bottom nav — solo mobile, mismo patrón que WhatsApp/Telegram/
          iMessage: tabs de ícono+label fijos abajo, con el safe-area de
          iOS respetado. */}
      <nav className="md:hidden flex border-t border-border/80 bg-panel/90 backdrop-blur-md shrink-0 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] transition-colors duration-150",
                active ? "text-accent" : "text-muted",
              )}
            >
              <Icon size={20} strokeWidth={2} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
