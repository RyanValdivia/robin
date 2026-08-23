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

V0 (listo) — CLI local, Claude Agent SDK, memory tools sobre este vault.

V1 (acá estamos, listo) — Memory Engine: Postgres+Redis vía Docker Compose,
`search_memory()`/`remember()` reales como MCP tools propios (`jarvis-memory`).
Embeddings 100% locales (`@huggingface/transformers`, sin API paga). El agente ya no
escribe archivos directo en `memory/` — todo pasa por `remember()` para que el índice
semántico nunca quede desincronizado.

V2 (listo) — Tools: GitHub MCP (oficial, vía Docker, PAT fine-grained del usuario),
Bash con `PreToolUse` hook denylist (rm -rf, sudo, pipe-a-shell, etc.), Playwright MCP
(browser). Rama AGENT completa.

V3 (en progreso) — Telegram + deploy 24/7 en el VPS.
- Código listo: adapter de Telegram (grammy, long-polling), auth por
  channel_identities, BrainSession compartida entre canales.
- Dockerfile + docker-compose.prod.yml + DEPLOY.md listos, unido a la red
  externa `traefik_proxy` (ya corriendo en el VPS) sin labels activas todavía
  (Telegram no necesita puerto entrante).
- Build verificado para linux/arm64 (arquitectura real del VPS) — build para
  amd64 local falla porque onnxruntime-node pide un paquete CUDA de nuget que
  arm64 no necesita; no es un problema real, es específico del build local en
  otra arquitectura.
- Pendiente: TELEGRAM_BOT_TOKEN y el ID de Telegram del usuario para probar en
  vivo y recién ahí tocar el VPS real.

V3 — Telegram + deploy 24/7 en el VPS.

V4 — Router híbrido por capacidad, LLM barato (Groq/Gemini) para DIRECT/KNOWLEDGE.

V5 — Proactividad: scheduler (BullMQ), no depende de Claude para funcionar.

V6 — Voz: `faster-whisper` + Piper, local, sin APIs de pago.

V7 — Más canales: Discord, WhatsApp (Baileys), Web UI.

## Plan completo

`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`
