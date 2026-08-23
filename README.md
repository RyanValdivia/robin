# Robin

Asistente personal con Claude (nombre en código interno del repo/infra: `jarvis`
— carpeta, DB, Docker; el proyecto se llama y se presenta como **Robin**).
Arquitectura completa en
`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`.

## Estado: V4 listo, corriendo 24/7 en el VPS

- **V0-V4 listas**: CLI local, memoria persistente (vault markdown + Postgres +
  pgvector para búsqueda semántica), Bash con guardarraíl, Playwright MCP, GitHub MCP,
  Telegram (`@robin_rv_bot`) desplegado y corriendo 24/7 en el VPS propio, router
  híbrido por capacidad (DIRECT sin LLM / KNOWLEDGE vía Groq / AGENT vía Claude).
- Siguiente: V5 — proactividad (scheduler, no depende de Claude para disparar).

## Desarrollo local

```
npm install
docker compose up -d          # Postgres + Redis
docker compose exec -T postgres psql -U jarvis -d jarvis < db/schema.sql   # solo la primera vez
npm run chat                  # CLI
```

Requiere estar logueado con Claude Code en esta máquina (`claude login` /
`claude setup-token`) — hereda esa autenticación automáticamente, sin API key.

Escribí `salir` para terminar el CLI.

## Deploy en VPS

Ver `DEPLOY.md`.

## Estructura

- `src/brain/session.ts` — sesión de conversación compartida por cualquier canal
  (memoria, tools, hooks, MCP).
- `src/brain/systemPrompt.ts` — persona ("Robin") + memoria inyectada al contexto.
- `src/brain/memory.ts` — `search_memory()`/`remember()` (grep + pgvector).
- `src/adapters/` — canales (CLI, Telegram, ...), thin, sin lógica de LLM.
- `memory/` — vault de conocimiento (fuente de verdad). Editable a mano (Obsidian
  compatible) o por Robin mismo cuando le pedís que recuerde algo.
