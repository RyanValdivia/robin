# Robin

Asistente personal con Claude — memoria propia (vault markdown + Postgres +
pgvector), router híbrido por capacidad (DIRECT sin LLM / KNOWLEDGE vía Groq /
AGENT vía Claude Agent SDK con GitHub/Bash/Browser), recordatorios proactivos,
corriendo 24/7 en VPS propio, hoy por Telegram. Arquitectura completa en
`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`.

## Estado: V6 listo, corriendo 24/7 en el VPS

- **V0-V6 listas**: CLI local, memoria persistente, Bash con guardarraíl,
  Playwright MCP, GitHub MCP, Telegram (`@robin_rv_bot`), router híbrido por
  capacidad, recordatorios proactivos (scheduler que no depende de Claude
  para disparar), notas de voz transcriptas con faster-whisper (`whisper/`,
  servicio Python aparte) — solo STT, sin respuestas en audio por ahora.
- Siguiente: V7 — más canales (Discord, WhatsApp, Web UI).

## Desarrollo local

```
npm install
docker compose up -d          # Postgres + Redis + whisper (STT)
docker compose exec -T postgres psql -U robin -d robin < db/schema.sql   # solo la primera vez
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
