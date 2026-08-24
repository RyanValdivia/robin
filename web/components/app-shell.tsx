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

export function AppShell() {
  const [tab, setTab] = useState<TabId>("chat");

  return (
    <div className="h-dvh flex flex-col bg-bg">
      {/* Header — en mobile la navegación vive abajo (bottom nav, como una
          app de mensajería); en desktop hay lugar de sobra arriba. */}
      <header className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
          <h1 className="text-sm font-semibold text-white">Robin</h1>
        </div>
        <nav className="hidden md:flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap",
                tab === t.id ? "bg-panel2 text-white" : "text-muted hover:text-gray-200",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

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

      {/* Bottom nav — solo mobile, mismo patrón que WhatsApp/Telegram/
          iMessage: tabs de ícono+label fijos abajo, con el safe-area de
          iOS respetado. */}
      <nav className="md:hidden flex border-t border-border bg-panel shrink-0 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] transition",
                tab === t.id ? "text-accent" : "text-muted",
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
