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

V3 (LISTO, EN VIVO EN EL VPS) — Telegram + deploy 24/7.
- Corriendo 24/7 en el VPS real (Oracle Ampere A1, `rvaldiviase-instance`),
  código en `~/server-data/jarvis` (mismo patrón que los demás servicios del
  VPS). Verificado en vivo desde Telegram real, no solo local.
- Deploy hecho por `git archive | ssh ... tar -x` (no hay remoto de GitHub
  para este repo todavía) en vez de `git clone` como decía DEPLOY.md.
- `.env.prod`: `POSTGRES_PASSWORD` random (openssl), tokens de Telegram/GitHub
  copiados del `.env` local, `CLAUDE_CODE_OAUTH_TOKEN` generado corriendo
  `claude setup-token` en un contenedor `node:24-slim` descartable en el VPS
  (no hace falta instalar node en el host).
- **Bug encontrado y arreglado en el deploy:** el contenedor corría como root
  (Dockerfile no tenía `USER`) y el Agent SDK manda `--dangerously-skip-permissions`
  (por `bypassPermissions`) — la CLI de Claude Code rechaza ese flag como root
  ("cannot be used with root/sudo privileges"), tiraba el proceso entero
  (`process_exited_nonzero`) y el contenedor entraba en crash-loop cada vez que
  llegaba un mensaje. Fix: `Dockerfile` crea user `jarvis` uid/gid 1001 (mismo
  uid que el usuario `ubuntu` del host, para que el bind mount `./memory` tenga
  permisos de escritura correctos) y corre con `USER jarvis`.
- Owner de Telegram bootstrapped en la DB del VPS (user_id=1, telegram
  6945356724, mismo que local).
- `docker compose -f docker-compose.prod.yml ps` → postgres/redis/jarvis los
  3 `Up`, `restart: unless-stopped`. Logs: `[telegram] listo — @robin_rv_bot`.
- Pendiente (no bloqueante): log rotation de Docker no configurada todavía en
  el VPS (`/etc/docker/daemon.json` no existe) — ver plan, sección Seguridad
  → higiene de disco. VPS tenía 21GB libres de 45GB antes de este deploy
  (bastante ya usado por los otros ~25 servicios que corren ahí: Pterodactyl,
  Turiston, registrame, Vaultwarden, Evolution API, Headscale, etc.)

V4 — Router híbrido por capacidad, LLM barato (Groq/Gemini) para DIRECT/KNOWLEDGE.

V5 — Proactividad: scheduler (BullMQ), no depende de Claude para funcionar.

V6 — Voz: `faster-whisper` + Piper, local, sin APIs de pago.

V7 — Más canales: Discord, WhatsApp (Baileys), Web UI.

## Plan completo

`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`
