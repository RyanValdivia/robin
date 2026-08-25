"use client";

import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CategoryCount = { category: string; count: number };
type GroqStats = { calls: number; promptTokens: number; completionTokens: number };
type Usage = { messagesAll: CategoryCount[]; messages30d: CategoryCount[]; groqAll: GroqStats; groq30d: GroqStats };

const EMPTY_GROQ: GroqStats = { calls: 0, promptTokens: 0, completionTokens: 0 };
const EMPTY_USAGE: Usage = { messagesAll: [], messages30d: [], groqAll: EMPTY_GROQ, groq30d: EMPTY_GROQ };

// Paleta categórica validada (skill de dataviz) — slots 1-3, hex de modo
// oscuro: blue/orange/aqua. Orden fijo, no ciclado.
const CATEGORIES = [
  { id: "direct", label: "Directo (sin LLM)", color: "#3987e5" },
  { id: "knowledge", label: "Conocimiento (Groq)", color: "#d95926" },
  { id: "agent", label: "Agente (Claude)", color: "#199e70" },
] as const;

const numberFormat = new Intl.NumberFormat("es-PE");

export function UsagePanel() {
  const [usage, setUsage] = useState<Usage>(EMPTY_USAGE);

  async function load() {
    try {
      const res = await fetch("/api/usage");
      const data = await res.json();
      setUsage({
        messagesAll: data.messagesAll || [],
        messages30d: data.messages30d || [],
        groqAll: data.groqAll || EMPTY_GROQ,
        groq30d: data.groq30d || EMPTY_GROQ,
      });
    } catch {
      // silencioso — queda lo último cargado
    }
  }

  useEffect(() => {
    load();
  }, []);

  function count(id: string, list: CategoryCount[]): number {
    return list.find((m) => m.category === id)?.count ?? 0;
  }

  const totalMessages = usage.messagesAll.reduce((sum, m) => sum + m.count, 0);
  const freeCount = count("direct", usage.messagesAll) + count("knowledge", usage.messagesAll);
  const freePercent = totalMessages === 0 ? 0 : Math.round((freeCount / totalMessages) * 100);
  const maxCount = Math.max(1, ...CATEGORIES.map((c) => count(c.id, usage.messagesAll)));
  const groqTokens = usage.groqAll.promptTokens + usage.groqAll.completionTokens;

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white tracking-tight">Uso del router</h2>
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 text-xs">
            <RotateCw size={13} /> actualizar
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-7">
          <Card>
            <CardHeader>
              <CardTitle>Mensajes totales</CardTitle>
            </CardHeader>
            <CardContent className="text-lg sm:text-2xl font-semibold text-white">{totalMessages}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sin tocar a Claude</CardTitle>
            </CardHeader>
            <CardContent className="text-lg sm:text-2xl font-semibold text-white">{freePercent}%</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tokens Groq</CardTitle>
            </CardHeader>
            <CardContent className="text-lg sm:text-2xl font-semibold text-white">
              {numberFormat.format(groqTokens)}
            </CardContent>
          </Card>
        </div>

        <Card className="px-5 py-5 mb-4">
          <div className="text-xs text-muted mb-4">Mensajes por rama del router (histórico)</div>
          {CATEGORIES.map((c) => {
            const value = count(c.id, usage.messagesAll);
            const value30d = count(c.id, usage.messages30d);
            return (
              <div key={c.id} className="mb-4 last:mb-0" title={`${value30d} en los últimos 30 días`}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-300">{c.label}</span>
                  <span className="text-gray-400 tabular-nums">{value}</span>
                </div>
                <div className="h-3 bg-panel2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(value / maxCount) * 100}%`, background: c.color }}
                  />
                </div>
              </div>
            );
          })}
        </Card>

        <p className="text-xs text-muted">
          DIRECT y CONOCIMIENTO no gastan cuota de Claude (DIRECT ni siquiera usa un LLM;
          CONOCIMIENTO usa Groq, gratis). Solo AGENTE toca la suscripción de Claude.
        </p>
      </div>
    </div>
  );
}
