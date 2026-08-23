---
type: project
name: Robin
description: Asistente personal con Claude — arquitectura y decisiones de diseño
---

# Robin

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

V1 (listo) — Memory Engine: Postgres+Redis vía Docker Compose,
`search_memory()`/`remember()` reales como MCP tools propios (`robin-memory`).
Embeddings 100% locales (`@huggingface/transformers`, sin API paga). El agente ya no
escribe archivos directo en `memory/` — todo pasa por `remember()` para que el índice
semántico nunca quede desincronizado.

V2 (listo) — Tools: GitHub MCP (oficial, binario copiado a la imagen), Bash con
`PreToolUse` hook denylist (rm -rf, sudo, pipe-a-shell, etc.), Playwright MCP
(browser). Rama AGENT completa.

V3 (LISTO, EN VIVO EN EL VPS) — Telegram + deploy 24/7.
- Corriendo 24/7 en el VPS real (Oracle Ampere A1, `rvaldiviase-instance`),
  código en `~/server-data/robin`. Verificado en vivo desde Telegram real.
- Deploy hecho por `git archive | ssh ... tar -x` (repo GitHub
  `RyanValdivia/robin`, público, portafolio).
- **Bug encontrado y arreglado en el deploy:** el contenedor corría como root
  y el Agent SDK manda `--dangerously-skip-permissions` — la CLI de Claude Code
  rechaza ese flag como root, crash-loop en cada mensaje. Fix: `Dockerfile`
  corre con `USER robin` (uid/gid 1001, igual al usuario `ubuntu` del host).
- Owner de Telegram bootstrapped en la DB del VPS (user_id=1, telegram
  6945356724).

V4 (LISTO, EN VIVO EN EL VPS) — Router híbrido por capacidad.
- `src/brain/router.ts`: heurística de keywords primero (gratis, sin red) →
  cae a LLM barato (Groq) si es ambigua → cae a AGENT (Claude) si no hay LLM
  barato configurado o algo falla. Nunca se pierde una respuesta por costo.
- DIRECT (saludo, hora/fecha, calculadora, recordatorios simples): cero LLM.
  AGENT/BrainSession de Claude es **lazy** en ambos adapters — solo se crea
  si el router manda algo a AGENT.
- KNOWLEDGE: `search_memory()` + Groq (`openai/gpt-oss-20b`) sintetiza la
  respuesta — no toca cuota de Claude.
- **Bugs encontrados en vivo y arreglados:** GitHub MCP invocaba `docker run`
  pero el contenedor de la app no tiene el socket de Docker del host (fix:
  binario copiado a la imagen vía multi-stage build); faltaban certificados
  CA para que el binario Go de github-mcp-server validara TLS (fix:
  `apt-get install ca-certificates`); regex `repo(sitorio)?` no matcheaba el
  plural "repos" (fix: `repos?(itorios?)?`).

V5 (LISTO, EN VIVO EN EL VPS) — Proactividad: scheduler.
- `src/brain/scheduler.ts`: BullMQ sobre Redis + tabla `scheduled_tasks`
  (Postgres). El worker que dispara NO llama a Claude — solo lee el texto
  guardado y lo empuja por el outbound sender que registra el adapter
  (hoy: Telegram).
- Router (DIRECT): "recordame X a las H" / "recordame X en N minutos/horas"
  se resuelve con regex + Date, cero LLM, tanto al crear como al disparar.
- Tools para AGENT (`schedule_task`/`list_reminders`/`cancel_reminder`): para
  cuando la fecha/hora no es trivial de parsear — Claude la calcula una vez
  al crear, el disparo sigue sin tocarlo.

V6 — Voz: `faster-whisper` + Piper, local, sin APIs de pago.

V7 — Más canales: Discord, WhatsApp (Baileys), Web UI.

## Rename jarvis → robin (proyecto completo)

Nombre en código inicial del repo fue `jarvis` (V0-V4); se renombró todo a
**Robin** — carpeta local y del VPS, repo de GitHub, rol/DB de Postgres
(`ALTER ROLE`/`ALTER DATABASE`, sin perder datos), contenedores/red Docker,
`package.json`, comentarios. Los volúmenes físicos de Docker en el VPS quedan
referenciados como `external: true` apuntando al nombre viejo
(`jarvis_jarvis_pg_data`/`jarvis_jarvis_redis_data`) para no tener que copiar
datos — es un detalle interno invisible, no afecta nada de lo que se ve/usa.

## Plan completo

`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`
