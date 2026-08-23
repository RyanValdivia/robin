---
type: project
name: JARVIS
description: Asistente personal con Claude — arquitectura y decisiones de diseño
---

# JARVIS

Asistente personal **reactivo** (actúa cuando se le pide, no autónomo), pensado para
correr 24/7 en el VPS propio del usuario (Oracle Cloud Ampere A1: 4 vCPU ARM, 23GB RAM,
45GB disco). Multi-canal: CLI, Telegram, Discord, WhatsApp, Web, voz.

## Decisiones clave

- **LLM:** Claude vía Agent SDK. `LLM_PROVIDER` configurable — por defecto
  `CLAUDE_CODE_OAUTH_TOKEN` (cuota de la suscripción Pro/Max, $0 extra), con salida
  limpia a `ANTHROPIC_API_KEY` (pago por token) si hace falta. El primero es zona gris
  de ToS para uso 24/7 (documentado para CI/scripts, no explícitamente para
  servicio persistente) — riesgo bajo a volumen personal, vigilar.
- **Router por capacidad**, no por complejidad binaria: DIRECT (scheduler/calculadora,
  sin LLM) / KNOWLEDGE (search_memory + LLM barato) / AGENT (Claude + GitHub/Bash/
  Browser).
- **Memoria en tres roles:** Obsidian/markdown (esta carpeta) = fuente de verdad;
  Postgres = memoria operacional (conversaciones, scheduling, audit log); pgvector =
  índice semántico opcional sobre el vault, no un almacén paralelo.
- **`search_memory()`** es una interfaz estable — la implementación evoluciona
  (V1 ripgrep → V2 Postgres FTS → V3 hybrid+pgvector → V4 +reranking) sin que el
  Agent Runtime tenga que cambiar.

## Roadmap

V0 (acá estamos) — CLI local, Claude Agent SDK, memory tools (Read/Write/Edit) sobre
este vault, sin Postgres/Redis/Docker todavía.

V1 — Memory Engine: Postgres+Redis+pgvector, `search_memory()`/`remember()`/
`update_memory()` reales.

V2 — Tools: GitHub MCP, Bash+hooks, Playwright MCP.

V3 — Telegram + deploy 24/7 en el VPS.

V4 — Router híbrido por capacidad, LLM barato (Groq/Gemini) para DIRECT/KNOWLEDGE.

V5 — Proactividad: scheduler (BullMQ), no depende de Claude para funcionar.

V6 — Voz: `faster-whisper` + Piper, local, sin APIs de pago.

V7 — Más canales: Discord, WhatsApp (Baileys), Web UI.

## Plan completo

`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`
