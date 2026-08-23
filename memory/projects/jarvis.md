---
type: project
name: Robin
description: Asistente personal con Claude — arquitectura y decisiones de diseño
---

# Robin

(Nombre en código interno del repo/infra: `jarvis` — carpeta, DB, contenedores
Docker. El proyecto/producto se llama y se presenta como **Robin**.)

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

V4 (LISTO, EN VIVO EN EL VPS) — Router híbrido por capacidad.
- `src/brain/router.ts`: heurística de keywords primero (gratis, sin red) →
  cae a LLM barato (Groq) si es ambigua → cae a AGENT (Claude) si no hay LLM
  barato configurado o algo falla. Nunca se pierde una respuesta por costo.
- DIRECT (saludo, hora/fecha, calculadora): cero LLM. AGENT/BrainSession de
  Claude ahora es **lazy** en ambos adapters (CLI y Telegram) — solo se crea
  si el router manda algo a AGENT.
- KNOWLEDGE: `search_memory()` + Groq (`openai/gpt-oss-20b`, gratis, no
  `llama-3.3-70b-versatile` que ya no existe en su catálogo) sintetiza la
  respuesta — no toca cuota de Claude.
- Verificado en vivo por Telegram: "342 + 34" → 376 sin LLM; "qué sabés de
  mis proyectos" → contestado por Groq.
- **Bug encontrado en vivo:** GitHub MCP se invocaba con `docker run ...`
  (`src/brain/mcp.ts`), pero el contenedor de `jarvis` no tiene el socket de
  Docker del host — fallaba en silencio, Claude decía no tener acceso a
  GitHub. Local funcionaba porque el host (Windows) sí tiene Docker Desktop.
  Fix: Dockerfile multi-stage copia el binario distroless
  (`ghcr.io/github/github-mcp-server` → `/usr/local/bin/github-mcp-server`)
  directo a la imagen; `mcp.ts` lo detecta vía env `GITHUB_MCP_BIN` y lo
  corre sin Docker de por medio (dev local sin esa var sigue usando
  `docker run` como antes). Deployado, pendiente re-probar en vivo.

V5 — Proactividad: scheduler (BullMQ), no depende de Claude para funcionar.

V6 — Voz: `faster-whisper` + Piper, local, sin APIs de pago.

V7 — Más canales: Discord, WhatsApp (Baileys), Web UI.

## Plan completo

`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`
