# Robin

Asistente personal con Claude (nombre en código del proyecto/repo: `jarvis`, el
asistente se presenta como **Robin**). Arquitectura completa en
`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`.

## Estado: V3 en progreso

- **V0-V2 listas**: CLI local, memoria persistente (vault markdown + Postgres +
  pgvector para búsqueda semántica), Bash con guardarraíl, Playwright MCP, GitHub MCP.
- **V3 en progreso**: adapter de Telegram (`src/adapters/telegram`), deploy artifacts
  (`Dockerfile`, `docker-compose.prod.yml`, `DEPLOY.md`) para el VPS — código listo,
  falta la primera prueba en vivo.

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
